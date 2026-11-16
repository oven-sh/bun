use bun_collections::HashMap;
use bun_core::strings;
use bun_core::{Output, feature_flags};
use bun_uws::AnyWebSocket;
use bun_uws_sys::{Opcode, SendStatus};

use super::source_map_store::{self, RemoveOrUpgradeMode};
use super::{ConsoleLogKind, DevServer, HmrTopic, IncomingMessageId, MessageId};
use crate::bake::dev_server::HmrTopicBits;

// Struct definition lives in `dev_server/mod.rs` so the public
// `crate::bake::dev_server::HmrSocket` path and these impl blocks name a
// single type (no cross-type pointer casts).
pub(crate) use super::HmrSocket;
use super::*;

struct InvalidMessage;

/// A batch to release once the state is no longer borrowed.
type MessageResult = Result<Option<TestingBatch>, InvalidMessage>;

impl HmrSocket {
    fn open(dev: &DevServerState, ws: AnyWebSocket) -> HmrSocket {
        let mut socket = HmrSocket {
            subscriptions: HmrTopicBits::empty(),
            active_route: None,
            referenced_source_maps: HashMap::default(),
            underlying: ws,
            inspector_connection_id: -1,
        };
        let mut header = [0u8; 1 + DevServer::CONFIGURATION_HASH_KEY_LEN];
        header[0] = MessageId::Version.char();
        header[1..].copy_from_slice(&dev.configuration_hash_key);
        let send_status = ws.send(&header, Opcode::Binary, false, true);

        if send_status != SendStatus::Dropped {
            // Notify inspector about client connection
            if let Some(agent) = dev.inspector() {
                socket.inspector_connection_id = agent.next_connection_id();
                agent.notify_client_connected(
                    dev.inspector_server_id,
                    socket.inspector_connection_id,
                );
            }
        }
        socket
    }

    fn on_message(&mut self, dev: &mut DevServerState, msg: &[u8]) -> MessageResult {
        let ws = self.underlying;
        if msg.is_empty() {
            return Err(InvalidMessage);
        }

        // `msg[0]` may be any byte. Transmuting an out-of-range u8 into a
        // #[repr(u8)] enum is UB regardless of a wildcard match arm — match on
        // the raw byte instead.
        match msg[0] {
            x if x == IncomingMessageId::Init as u8 => {
                if msg.len() != 9 {
                    return Err(InvalidMessage);
                }
                let mut generation_bytes = [0u8; 4];
                if strings::decode_hex_to_bytes(&mut generation_bytes, &msg[1..]).is_err() {
                    return Err(InvalidMessage);
                }
                let generation = u32::from_ne_bytes(generation_bytes);
                let source_map_id = source_map_store::Key::init((generation as u64) << 32);
                if dev
                    .source_maps
                    .remove_or_upgrade_weak_ref(source_map_id, RemoveOrUpgradeMode::Upgrade)
                {
                    self.referenced_source_maps.insert(source_map_id, ());
                }
            }
            x if x == IncomingMessageId::Subscribe as u8 => {
                let mut new_bits = HmrTopicBits::empty();
                let topics = &msg[1..];
                if topics.len() > HmrTopic::MAX_COUNT {
                    return Ok(None);
                }
                for &ch in topics {
                    if let Some(topic) = HmrTopic::from_u8(ch) {
                        new_bits.insert(topic.as_bit());
                    }
                }
                for &field in HmrTopic::ALL {
                    let bit = field.as_bit();
                    if new_bits.contains(bit) && !self.subscriptions.contains(bit) {
                        let _ = ws.subscribe(&field.uws_topic());

                        // on-subscribe hooks
                        if feature_flags::BAKE_DEBUGGING_FEATURES {
                            match field {
                                HmrTopic::IncrementalVisualizer => {
                                    dev.emit_incremental_visualizer_events += 1;
                                }
                                HmrTopic::MemoryVisualizer => {
                                    dev.emit_memory_visualizer_events += 1;
                                    dev.emit_memory_visualizer_message();
                                    if dev.emit_memory_visualizer_events == 1 {
                                        debug_assert!(
                                            !dev.timers.memory_visualizer_timer.is_active()
                                        );
                                        dev.timers.as_pin_ref().arm_memory_visualizer_timer();
                                    }
                                }
                                _ => {}
                            }
                        }
                    } else if !new_bits.contains(bit) && self.subscriptions.contains(bit) {
                        let _ = ws.unsubscribe(&field.uws_topic());
                    }
                }
                Self::on_unsubscribe(dev, !new_bits & self.subscriptions);
                self.subscriptions = new_bits;
            }
            x if x == IncomingMessageId::SetUrl as u8 => {
                let pattern = &msg[1..];
                // `match_slow` requires an absolute path; these are peer bytes.
                if pattern.first() != Some(&b'/') {
                    return Err(InvalidMessage);
                }
                let maybe_rbi = dev.route_to_bundle_index_slow(pattern);
                if let Some(agent) = dev.inspector() {
                    if self.inspector_connection_id > -1 {
                        let pattern_str = bun_core::StringView::from_bytes(pattern);
                        agent.notify_client_navigated(
                            dev.inspector_server_id,
                            self.inspector_connection_id,
                            &pattern_str,
                            maybe_rbi.map(|i| i.get() as i32).unwrap_or(-1),
                        );
                    }
                }
                let Some(rbi) = maybe_rbi else {
                    return Ok(None);
                };
                if let Some(old) = self.active_route {
                    if old == rbi {
                        return Ok(None);
                    }
                    dev.route_bundle_ptr(old).active_viewers -= 1;
                }
                dev.route_bundle_ptr(rbi).active_viewers += 1;
                self.active_route = Some(rbi);
                let mut response = [0u8; 5];
                response[0] = MessageId::SetUrlResponse.char();
                response[1..].copy_from_slice(&rbi.get().to_ne_bytes());

                let _ = ws.send(&response, Opcode::Binary, false, true);
            }
            x if x == IncomingMessageId::TestingBatchEvents as u8 => {
                match &dev.testing_batch_events {
                    super::TestingBatchEvents::Disabled => {
                        if dev.current_bundle.is_some() {
                            dev.testing_batch_events = super::TestingBatchEvents::EnableAfterBundle;
                        } else {
                            dev.testing_batch_events =
                                super::TestingBatchEvents::Enabled(Default::default());
                            dev.publish(
                                HmrTopic::TestingWatchSynchronization,
                                &[MessageId::TestingWatchSynchronization.char(), 0],
                                bun_uws::Opcode::BINARY,
                            );
                        }
                    }
                    super::TestingBatchEvents::EnableAfterBundle
                    | super::TestingBatchEvents::ReleaseAfterBundle(_) => {
                        // A duplicate `H` is a protocol violation, not an invariant.
                        return Err(InvalidMessage);
                    }
                    super::TestingBatchEvents::Enabled(_event_const) => {
                        // Replace-and-extract to satisfy borrowck.
                        let super::TestingBatchEvents::Enabled(batch) = core::mem::replace(
                            &mut dev.testing_batch_events,
                            super::TestingBatchEvents::Disabled,
                        ) else {
                            unreachable!()
                        };

                        // An unbundled route's request can start a bundle;
                        // `start_async_bundle` requires none in flight.
                        if dev.current_bundle.is_some() {
                            dev.testing_batch_events =
                                super::TestingBatchEvents::ReleaseAfterBundle(batch);
                            return Ok(None);
                        }

                        return Ok(Some(batch));
                    }
                }
            }
            x if x == IncomingMessageId::ConsoleLog as u8 => {
                if msg.len() < 2 {
                    return Err(InvalidMessage);
                }

                let kind = match msg[1] {
                    b'l' => ConsoleLogKind::Log,
                    b'e' => ConsoleLogKind::Err,
                    _ => {
                        return Err(InvalidMessage);
                    }
                };

                let data = &msg[2..];

                if let Some(agent) = dev.inspector() {
                    let log_str = bun_core::StringView::from_bytes(data);
                    agent.notify_console_log(dev.inspector_server_id, kind as u8, &log_str);
                }

                if dev.broadcast_console_log_from_browser_to_server {
                    let arena = bun_alloc::Arena::new();
                    let data = super::error_report_request::sanitize_for_terminal(data, &arena);
                    match kind {
                        ConsoleLogKind::Log => {
                            bun_core::pretty!("<r><d>[browser]<r> {}<r>\n", bstr::BStr::new(data));
                        }
                        ConsoleLogKind::Err => {
                            bun_core::pretty_error!(
                                "<r><d>[browser]<r> {}<r>\n",
                                bstr::BStr::new(data)
                            );
                        }
                    }
                    Output::flush();
                }
            }
            x if x == IncomingMessageId::UnrefSourceMap as u8 => {
                let payload = &msg[1..];
                let Ok(bytes) = <[u8; 8]>::try_from(payload.get(0..8).unwrap_or(&[])) else {
                    return Err(InvalidMessage);
                };
                let source_map_id = source_map_store::Key::init(u64::from_le_bytes(bytes));
                let Some(kv) = self.referenced_source_maps.remove_entry(&source_map_id) else {
                    bun_core::debug_warn!(
                        "unref_source_map: no entry found: {:x}\n",
                        source_map_id.get()
                    );
                    return Ok(None); // no entry may happen.
                };
                dev.source_maps.unref(kv.0);
            }
            _ => return Err(InvalidMessage),
        }
        Ok(None)
    }

    fn on_unsubscribe(dev: &mut DevServerState, field: HmrTopicBits) {
        if feature_flags::BAKE_DEBUGGING_FEATURES {
            if field.contains(HmrTopic::IncrementalVisualizer.as_bit()) {
                dev.emit_incremental_visualizer_events -= 1;
            }
            if field.contains(HmrTopic::MemoryVisualizer.as_bit()) {
                dev.emit_memory_visualizer_events -= 1;
                if dev.emit_memory_visualizer_events == 0 {
                    dev.timers.memory_visualizer_timer.disarm();
                }
            }
        }
    }

    /// Drops this socket's visualizer subscriptions, `active_viewers` count and source map refs.
    fn release(&self, dev: &mut DevServerState) {
        Self::on_unsubscribe(dev, self.subscriptions);

        if self.inspector_connection_id > -1 {
            // Notify inspector about client disconnection
            if let Some(agent) = dev.inspector() {
                agent.notify_client_disconnected(
                    dev.inspector_server_id,
                    self.inspector_connection_id,
                );
            }
        }

        if let Some(old) = self.active_route {
            dev.route_bundle_ptr(old).active_viewers -= 1;
        }

        for key in self.referenced_source_maps.keys() {
            dev.source_maps.unref(*key);
        }
    }
}

pub(super) fn hmr_socket_behavior<const SSL: bool>() -> bun_uws_sys::WebSocketBehavior {
    bun_uws_sys::web_socket::Wrap::<DevServer, DevServer, SSL>::apply(&Default::default())
}

impl DevServerState {
    fn remove_socket(&mut self, ws: AnyWebSocket) -> HmrSocket {
        let sockets = &mut self.active_websocket_connections;
        let index = (sockets.iter()).position(|socket| socket.underlying.raw() == ws.raw());
        sockets.swap_remove(index.expect("added by `on_open`"))
    }
}

/// The user data of every socket is the `DevServer`, which closes its sockets before it goes.
impl bun_uws_sys::web_socket::WebSocketHandler for DevServer {
    // `Wrap.apply` leaves the drain/ping/pong C callbacks `null` when
    // `HAS_ON_* == false`.
    const HAS_ON_DRAIN: bool = false;
    const HAS_ON_PING: bool = false;
    const HAS_ON_PONG: bool = false;

    #[inline]
    unsafe fn on_open(this: *mut Self, ws: bun_uws_sys::AnyWebSocket) {
        // SAFETY: `OwnedDevServer` closes the sockets before it drops.
        let mut dev = unsafe { &*this }.state_mut();
        let socket = HmrSocket::open(&dev, ws);
        dev.active_websocket_connections.push(socket);
    }
    #[inline]
    unsafe fn on_message(
        this: *mut Self,
        ws: bun_uws_sys::AnyWebSocket,
        message: &[u8],
        _opcode: bun_uws_sys::Opcode,
    ) {
        // SAFETY: `OwnedDevServer` closes the sockets before it drops.
        let dev_server = unsafe { &*this };
        let mut dev = dev_server.state_mut();
        let mut socket = dev.remove_socket(ws);
        let result = socket.on_message(&mut dev, message);
        dev.active_websocket_connections.push(socket);
        drop(dev);
        match result {
            Ok(None) => {}
            Ok(Some(batch)) => dev_server.release_testing_batch(batch),
            Err(InvalidMessage) => ws.close(),
        }
    }
    #[inline]
    unsafe fn on_close(this: *mut Self, ws: bun_uws_sys::AnyWebSocket, _: i32, _: &[u8]) {
        // SAFETY: `OwnedDevServer` closes the sockets before it drops.
        let mut dev = unsafe { &*this }.state_mut();
        dev.remove_socket(ws).release(&mut dev);
    }
    unsafe fn on_drain(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket) {}
    unsafe fn on_ping(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket, _message: &[u8]) {}
    unsafe fn on_pong(_this: *mut Self, _ws: bun_uws_sys::AnyWebSocket, _message: &[u8]) {}
}

impl<const SSL: bool> bun_uws_sys::web_socket::WebSocketUpgradeServer<SSL> for DevServer {
    unsafe fn on_websocket_upgrade(
        this: *mut Self,
        res: *mut bun_uws_sys::NewAppResponse<SSL>,
        req: &mut Request,
        upgrade_ctx: &mut WebSocketUpgradeContext,
        id: usize,
    ) {
        debug_assert_eq!(id, 0);
        // SAFETY: `set_routes` registered `this`. uWS passes a response that is live for the callback.
        let (dev_server, res) = unsafe { (&*this, &mut *res) };
        if !is_allowed_dev_host(dev_server, req) {
            return host_forbidden(res.as_any_response());
        }
        if !is_allowed_dev_origin(req) {
            return origin_forbidden(res.as_any_response());
        }
        // `upgrade` ends the HTTP connection, and a stopped server frees `this` with its last one.
        let _pending = PendingRequest::new(dev_server.server);
        res.upgrade(
            this,
            req.header(b"sec-websocket-key").unwrap_or(b""),
            req.header(b"sec-websocket-protocol").unwrap_or(b""),
            req.header(b"sec-websocket-extension").unwrap_or(b""),
            Some(upgrade_ctx),
        );
    }
}

impl DevServerState {
    pub(crate) fn publish(&self, topic: HmrTopic, message: &[u8], opcode: Opcode) {
        let _ = (self.server).publish(&topic.uws_topic(), message, opcode, false);
    }

    pub(crate) fn num_subscribers(&self, topic: HmrTopic) -> u32 {
        self.server.num_subscribers(&topic.uws_topic())
    }

    /// Either of two conditions make this true:
    /// - The inspector is enabled
    /// - The user passed "console": true in serve options
    pub(super) fn should_receive_console_log_from_browser(&self) -> bool {
        self.inspector().is_some() || self.broadcast_console_log_from_browser_to_server
    }
}
