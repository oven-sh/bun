use core::cell::Cell;

use bun_collections::HashMap;
use bun_core::strings;
use bun_core::{Output, feature_flags};
use bun_ptr::{JsCell, ThisPtr};
use bun_uws::AnyWebSocket;
use bun_uws_sys::{Opcode, SendStatus};

use crate::timer::EventLoopTimerState;

use super::source_map_store::{self, RemoveOrUpgradeMode};
use super::{ConsoleLogKind, DevServer, DevServerCell, HmrTopic, IncomingMessageId, MessageId};
use crate::bake::dev_server_body::HmrTopicBits;

// Struct definition lives in `dev_server/mod.rs` so the public
// `crate::bake::dev_server::HmrSocket` path and these impl blocks name a
// single type (no cross-type pointer casts).
pub(crate) use super::HmrSocket;

impl HmrSocket {
    pub(crate) fn new(dev: bun_ptr::BackRef<DevServerCell>) -> HmrSocket {
        HmrSocket {
            ref_count: Cell::new(1),
            dev: Cell::new(Some(dev)),
            subscriptions: Cell::new(HmrTopicBits::empty()),
            active_route: Cell::new(None),
            referenced_source_maps: JsCell::new(HashMap::default()),
            underlying: Cell::new(None),
            inspector_connection_id: Cell::new(-1),
        }
    }

    /// The owning dev server, or `None` once it has detached this socket
    /// (`detach_from_dev_server`) on its way to closing it.
    fn dev(&self) -> Option<bun_ptr::BackRef<DevServerCell>> {
        self.dev.get()
    }

    fn on_open(&self, ws: AnyWebSocket) {
        self.underlying.set(Some(ws));
        let Some(dev) = self.dev() else { return };
        dev.with_mut(|dev| {
            let mut header = [0u8; 1 + DevServer::CONFIGURATION_HASH_KEY_LEN];
            header[0] = MessageId::Version.char();
            header[1..].copy_from_slice(&dev.configuration_hash_key);
            let send_status = ws.send(&header, Opcode::Binary, false, true);

            if send_status != SendStatus::Dropped {
                // Notify inspector about client connection
                if let Some(agent) = dev.inspector() {
                    self.inspector_connection_id.set(agent.next_connection_id());
                    agent.notify_client_connected(
                        dev.inspector_server_id,
                        self.inspector_connection_id.get(),
                    );
                }
            }
        });
    }

    fn on_message(&self, ws: AnyWebSocket, msg: &[u8], _opcode: Opcode) {
        if msg.is_empty() {
            return ws.close();
        }
        let Some(dev_cell) = self.dev() else { return };

        // `msg[0]` may be any byte. Transmuting an out-of-range u8 into a
        // #[repr(u8)] enum is UB regardless of a wildcard match arm — match on
        // the raw byte instead.
        match msg[0] {
            x if x == IncomingMessageId::Init as u8 => {
                if msg.len() != 9 {
                    return ws.close();
                }
                let mut generation_bytes = [0u8; 4];
                if strings::decode_hex_to_bytes(&mut generation_bytes, &msg[1..]).is_err() {
                    return ws.close();
                }
                let generation = u32::from_ne_bytes(generation_bytes);
                let source_map_id = source_map_store::Key::init((generation as u64) << 32);
                let upgraded = dev_cell.with_mut(|dev| {
                    dev.source_maps
                        .remove_or_upgrade_weak_ref(source_map_id, RemoveOrUpgradeMode::Upgrade)
                });
                if upgraded {
                    self.referenced_source_maps
                        .with_mut(|maps| maps.insert(source_map_id, ()));
                }
            }
            x if x == IncomingMessageId::Subscribe as u8 => {
                let mut new_bits = HmrTopicBits::empty();
                let topics = &msg[1..];
                if topics.len() > HmrTopic::MAX_COUNT {
                    return;
                }
                for &ch in topics {
                    if let Some(topic) = HmrTopic::from_u8(ch) {
                        new_bits.insert(topic.as_bit());
                    }
                }
                let subscriptions = self.subscriptions.get();
                for &field in HmrTopic::ALL {
                    let bit = field.as_bit();
                    if new_bits.contains(bit) && !subscriptions.contains(bit) {
                        let _ = ws.subscribe(&field.uws_topic());

                        // on-subscribe hooks
                        if feature_flags::BAKE_DEBUGGING_FEATURES {
                            dev_cell.with_mut(|dev| match field {
                                HmrTopic::IncrementalVisualizer => {
                                    dev.emit_incremental_visualizer_events += 1;
                                    dev.emit_visualizer_message_if_needed();
                                }
                                HmrTopic::MemoryVisualizer => {
                                    dev.emit_memory_visualizer_events += 1;
                                    dev.emit_memory_visualizer_message();
                                    if dev.emit_memory_visualizer_events == 1 {
                                        debug_assert!(
                                            dev.memory_visualizer_timer.state
                                                != EventLoopTimerState::ACTIVE
                                        );
                                        let next = bun_core::Timespec::ms_from_now(
                                            bun_core::TimespecMockMode::ForceRealTime,
                                            1000,
                                        );
                                        crate::jsc_hooks::timer_all_mut()
                                            .update(&raw mut dev.memory_visualizer_timer, &next);
                                    }
                                }
                                _ => {}
                            });
                        }
                    } else if new_bits.contains(bit) && !subscriptions.contains(bit) {
                        // Note: this `else if` condition is identical to the `if`
                        // above and is therefore unreachable; likely a bug
                        // (intended: `!new && old` → unsubscribe).
                        let _ = ws.unsubscribe(&field.uws_topic());
                    }
                }
                dev_cell.with_mut(|dev| self.on_unsubscribe(dev, !new_bits & subscriptions));
                self.subscriptions.set(new_bits);
            }
            x if x == IncomingMessageId::SetUrl as u8 => {
                let pattern = &msg[1..];
                let rbi = dev_cell.with_mut(|dev| {
                    let maybe_rbi = dev.route_to_bundle_index_slow(pattern);
                    if let Some(agent) = dev.inspector() {
                        if self.inspector_connection_id.get() > -1 {
                            let pattern_str = bun_core::String::from_bytes(pattern);
                            agent.notify_client_navigated(
                                dev.inspector_server_id,
                                self.inspector_connection_id.get(),
                                &pattern_str,
                                maybe_rbi.map(|i| i.get() as i32).unwrap_or(-1),
                            );
                        }
                    }
                    let rbi = maybe_rbi?;
                    if let Some(old) = self.active_route.get() {
                        if old == rbi {
                            return None;
                        }
                        dev.route_bundle_ptr(old).active_viewers -= 1;
                    }
                    dev.route_bundle_ptr(rbi).active_viewers += 1;
                    Some(rbi)
                });
                let Some(rbi) = rbi else { return };
                self.active_route.set(Some(rbi));
                let mut response = [0u8; 5];
                response[0] = MessageId::SetUrlResponse.char();
                response[1..].copy_from_slice(&rbi.get().to_ne_bytes());

                let _ = ws.send(&response, Opcode::Binary, false, true);
            }
            x if x == IncomingMessageId::TestingBatchEvents as u8 => {
                let mut bundle = None;
                let close = dev_cell.with_mut(|dev| match &dev.testing_batch_events {
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
                        false
                    }
                    super::TestingBatchEvents::EnableAfterBundle => {
                        // do not expose a websocket event that panics a release build
                        debug_assert!(false);
                        true
                    }
                    super::TestingBatchEvents::Enabled(_event_const) => {
                        let super::TestingBatchEvents::Enabled(event) = core::mem::replace(
                            &mut dev.testing_batch_events,
                            super::TestingBatchEvents::Disabled,
                        ) else {
                            unreachable!()
                        };

                        if event.entry_points.set.count() == 0 {
                            dev.publish(
                                HmrTopic::TestingWatchSynchronization,
                                &[MessageId::TestingWatchSynchronization.char(), 2],
                                bun_uws::Opcode::BINARY,
                            );
                            return false;
                        }

                        bundle = Some(super::BundleRequest {
                            entry_points: event.entry_points,
                            had_reload_event: true,
                            timer: std::time::Instant::now(),
                        });
                        false
                    }
                });
                if let Some(bundle) = bundle {
                    DevServer::start_async_bundle(&dev_cell, bundle).expect("OOM");
                }
                if close {
                    ws.close();
                }
            }
            x if x == IncomingMessageId::ConsoleLog as u8 => {
                if msg.len() < 2 {
                    ws.close();
                    return;
                }

                let kind = match msg[1] {
                    b'l' => ConsoleLogKind::Log,
                    b'e' => ConsoleLogKind::Err,
                    _ => {
                        ws.close();
                        return;
                    }
                };

                let data = &msg[2..];
                let dev: &DevServer = DevServerCell::get(&dev_cell);

                if let Some(agent) = dev.inspector() {
                    let log_str = bun_core::String::from_bytes(data);
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
                    return ws.close();
                };
                let source_map_id = source_map_store::Key::init(u64::from_le_bytes(bytes));
                let removed = self
                    .referenced_source_maps
                    .with_mut(|maps| maps.remove_entry(&source_map_id));
                let Some(kv) = removed else {
                    bun_core::debug_warn!(
                        "unref_source_map: no entry found: {:x}\n",
                        source_map_id.get()
                    );
                    return; // no entry may happen.
                };
                dev_cell.with_mut(|dev| dev.source_maps.unref(kv.0));
            }
            _ => ws.close(),
        }
    }

    fn on_unsubscribe(&self, dev: &mut DevServer, field: HmrTopicBits) {
        if feature_flags::BAKE_DEBUGGING_FEATURES {
            if field.contains(HmrTopic::IncrementalVisualizer.as_bit()) {
                dev.emit_incremental_visualizer_events -= 1;
            }
            if field.contains(HmrTopic::MemoryVisualizer.as_bit()) {
                dev.emit_memory_visualizer_events -= 1;
                if dev.emit_memory_visualizer_events == 0
                    && dev.memory_visualizer_timer.state == EventLoopTimerState::ACTIVE
                {
                    crate::jsc_hooks::timer_all_mut().remove(&raw mut dev.memory_visualizer_timer);
                }
            }
        }
    }

    /// Everything `on_close` does to the dev server, so that
    /// `Drop for DevServer` can run it itself before closing the socket (its
    /// `on_close` then finds itself already removed and leaves `dev` alone).
    pub(crate) fn detach_from_dev_server(&self, dev: &mut DevServer) {
        self.dev.set(None);
        self.on_unsubscribe(dev, self.subscriptions.replace(HmrTopicBits::empty()));

        if self.inspector_connection_id.get() > -1 {
            // Notify inspector about client disconnection
            if let Some(agent) = dev.inspector() {
                agent.notify_client_disconnected(
                    dev.inspector_server_id,
                    self.inspector_connection_id.get(),
                );
            }
            self.inspector_connection_id.set(-1);
        }

        if let Some(old) = self.active_route.take() {
            dev.route_bundle_ptr(old).active_viewers -= 1;
        }

        for key in self
            .referenced_source_maps
            .replace(HashMap::default())
            .keys()
        {
            dev.source_maps.unref(*key);
        }
    }

    fn on_close(&self, _ws: AnyWebSocket, _exit_code: i32, _message: &[u8]) {
        // `None` when `Drop for DevServer` is the one closing this socket.
        let Some(dev) = self.dev() else { return };
        dev.with_mut(|dev| {
            let removed = dev
                .active_websocket_connections
                .remove(&(std::ptr::from_ref(self) as usize));
            debug_assert!(removed.is_some());
            self.detach_from_dev_server(dev);
            drop(removed);
        });
    }
}

impl bun_uws_sys::web_socket::WebSocketHandlerRef for HmrSocket {
    // `Wrap.apply` leaves the drain/ping/pong C callbacks `null` when
    // `HAS_ON_* == false`.
    const HAS_ON_DRAIN: bool = false;
    const HAS_ON_PING: bool = false;
    const HAS_ON_PONG: bool = false;

    fn on_open(this: ThisPtr<Self>, ws: AnyWebSocket) {
        this.get().on_open(ws)
    }
    fn on_message(this: ThisPtr<Self>, ws: AnyWebSocket, message: &[u8], opcode: Opcode) {
        this.get().on_message(ws, message, opcode)
    }
    fn on_close(this: ThisPtr<Self>, ws: AnyWebSocket, code: i32, message: &[u8]) {
        this.get().on_close(ws, code, message)
    }
}
