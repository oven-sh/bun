//! HTTP/2 adapter for the transport-neutral stream WebSocket lifecycle.

use core::ffi::c_void;

use super::Response;
use crate::stream_websocket as websocket_core;

bun_opaque::opaque_ffi! { pub struct Parser; }

pub struct H2Transport;

pub type WebSocket = websocket_core::WebSocket<H2Transport>;
pub type WebSocketBehavior = websocket_core::WebSocketBehavior<H2Transport>;

mod c {
    use core::ffi::c_void;

    use super::{Parser, Response};

    unsafe extern "C" {
        pub(super) fn uws_h2_ws_parser_create(
            response: *mut Response,
            max_payload_length: usize,
            max_backpressure: usize,
            close_on_backpressure_limit: bool,
            compression: u16,
            extension_offer: *const u8,
            extension_offer_length: usize,
            user: *mut c_void,
            fragment_handler: unsafe extern "C" fn(
                *mut c_void,
                *const u8,
                usize,
                u32,
                i32,
                bool,
            ) -> bool,
            fail_handler: unsafe extern "C" fn(*mut c_void, i32),
        ) -> *mut Parser;
        pub(super) fn uws_h2_ws_parser_consume(parser: *mut Parser, data: *const u8, length: usize);
        pub(super) fn uws_h2_ws_parser_destroy(parser: *mut Parser);
        pub(super) fn uws_h2_ws_parser_memory_cost(parser: *mut Parser) -> usize;
        pub(super) fn uws_h2_ws_subscribe(
            parser: *mut Parser,
            topic: *const u8,
            length: usize,
        ) -> bool;
        pub(super) fn uws_h2_ws_unsubscribe(
            parser: *mut Parser,
            topic: *const u8,
            length: usize,
        ) -> bool;
        pub(super) fn uws_h2_ws_is_subscribed(
            parser: *mut Parser,
            topic: *const u8,
            length: usize,
        ) -> bool;
        pub(super) fn uws_h2_ws_publish(
            parser: *mut Parser,
            topic: *const u8,
            topic_length: usize,
            data: *const u8,
            data_length: usize,
            opcode: i32,
            compress: bool,
        ) -> u32;
        pub(super) fn uws_h2_ws_get_topics(
            parser: *mut Parser,
            callback: unsafe extern "C" fn(*mut c_void, *const u8, usize),
            user: *mut c_void,
        );
        pub(super) fn uws_h2_ws_unsubscribe_all(parser: *mut Parser);
        pub(super) fn uws_h2_ws_send(
            parser: *mut Parser,
            data: *const u8,
            length: usize,
            opcode: i32,
            compress: bool,
            fin: bool,
            max_backpressure: usize,
            limit_exceeded: *mut bool,
        ) -> u32;
    }
}

#[allow(unsafe_op_in_unsafe_fn)]
impl websocket_core::Transport for H2Transport {
    type Response = Response;
    type Parser = Parser;

    unsafe fn parser_create(
        response: *mut Response,
        max_payload_length: usize,
        max_backpressure: usize,
        close_on_backpressure_limit: bool,
        compression: u16,
        extension_offer: &[u8],
        user: *mut c_void,
        fragment_handler: unsafe extern "C" fn(
            *mut c_void,
            *const u8,
            usize,
            u32,
            i32,
            bool,
        ) -> bool,
        fail_handler: unsafe extern "C" fn(*mut c_void, i32),
    ) -> *mut Parser {
        c::uws_h2_ws_parser_create(
            response,
            max_payload_length,
            max_backpressure,
            close_on_backpressure_limit,
            compression,
            extension_offer.as_ptr(),
            extension_offer.len(),
            user,
            fragment_handler,
            fail_handler,
        )
    }

    unsafe fn parser_consume(parser: *mut Parser, data: *const u8, length: usize) {
        c::uws_h2_ws_parser_consume(parser, data, length)
    }
    unsafe fn parser_destroy(parser: *mut Parser) {
        c::uws_h2_ws_parser_destroy(parser)
    }
    unsafe fn parser_memory_cost(parser: *mut Parser) -> usize {
        c::uws_h2_ws_parser_memory_cost(parser)
    }
    unsafe fn parser_subscribe(parser: *mut Parser, topic: *const u8, length: usize) -> bool {
        c::uws_h2_ws_subscribe(parser, topic, length)
    }
    unsafe fn parser_unsubscribe(parser: *mut Parser, topic: *const u8, length: usize) -> bool {
        c::uws_h2_ws_unsubscribe(parser, topic, length)
    }
    unsafe fn parser_is_subscribed(parser: *mut Parser, topic: *const u8, length: usize) -> bool {
        c::uws_h2_ws_is_subscribed(parser, topic, length)
    }
    unsafe fn parser_publish(
        parser: *mut Parser,
        topic: *const u8,
        topic_length: usize,
        data: *const u8,
        data_length: usize,
        opcode: i32,
        compress: bool,
    ) -> u32 {
        c::uws_h2_ws_publish(
            parser,
            topic,
            topic_length,
            data,
            data_length,
            opcode,
            compress,
        )
    }
    unsafe fn parser_get_topics(
        parser: *mut Parser,
        callback: unsafe extern "C" fn(*mut c_void, *const u8, usize),
        user: *mut c_void,
    ) {
        c::uws_h2_ws_get_topics(parser, callback, user)
    }
    unsafe fn parser_unsubscribe_all(parser: *mut Parser) {
        c::uws_h2_ws_unsubscribe_all(parser)
    }
    unsafe fn parser_send(
        parser: *mut Parser,
        data: *const u8,
        length: usize,
        opcode: i32,
        compress: bool,
        fin: bool,
        max_backpressure: usize,
        limit_exceeded: *mut bool,
    ) -> u32 {
        c::uws_h2_ws_send(
            parser,
            data,
            length,
            opcode,
            compress,
            fin,
            max_backpressure,
            limit_exceeded,
        )
    }

    unsafe fn response_on_data(
        response: *mut Response,
        handler: unsafe extern "C" fn(*mut Response, *const u8, usize, bool, *mut c_void),
        user: *mut c_void,
    ) {
        super::c::uws_h2_res_on_data(&mut *response, Some(handler), user)
    }
    unsafe fn response_on_writable(
        response: *mut Response,
        handler: unsafe extern "C" fn(*mut Response, u64, *mut c_void) -> bool,
        user: *mut c_void,
    ) {
        super::c::uws_h2_res_on_writable(&mut *response, Some(handler), user)
    }
    unsafe fn response_on_aborted(
        response: *mut Response,
        handler: unsafe extern "C" fn(*mut Response, *mut c_void),
        user: *mut c_void,
    ) {
        super::c::uws_h2_res_on_aborted(&mut *response, Some(handler), user)
    }
    unsafe fn response_on_timeout(
        response: *mut Response,
        handler: unsafe extern "C" fn(*mut Response, *mut c_void),
        user: *mut c_void,
    ) {
        super::c::uws_h2_res_on_timeout(&mut *response, Some(handler), user)
    }
    unsafe fn response_websocket_timeout(response: *mut Response, seconds: u16) {
        super::c::uws_h2_res_websocket_timeout(&mut *response, seconds)
    }
    unsafe fn response_websocket_timeout_config(
        response: *mut Response,
        seconds: u16,
        refresh_on_write: bool,
    ) {
        super::c::uws_h2_res_websocket_timeout_config(&mut *response, seconds, refresh_on_write)
    }
    unsafe fn response_websocket_timeout_refresh_on_write(response: *mut Response, enabled: bool) {
        super::c::uws_h2_res_websocket_timeout_refresh_on_write(&mut *response, enabled)
    }
    unsafe fn response_get_buffered_amount(response: *mut Response) -> u64 {
        super::c::uws_h2_res_get_buffered_amount(&mut *response)
    }
    unsafe fn response_remote_address(response: *mut Response) -> Option<crate::SocketAddress> {
        let mut port = 0;
        let mut is_ipv6 = false;
        let mut ip_ptr = core::ptr::null();
        let len = super::c::uws_h2_res_get_remote_address_info(
            &mut *response,
            &mut ip_ptr,
            &mut port,
            &mut is_ipv6,
        );
        if len == 0 {
            return None;
        }
        let ip = bun_core::ffi::slice(ip_ptr, len);
        Some(crate::SocketAddress::new(ip, port, is_ipv6))
    }
    unsafe fn response_end_stream(response: *mut Response, close_connection: bool) {
        super::c::uws_h2_res_end_stream(&mut *response, close_connection)
    }
    unsafe fn response_cancel(response: *mut Response) {
        super::c::uws_h2_res_cancel(&mut *response)
    }
    unsafe fn response_cork(
        response: *mut Response,
        user: *mut c_void,
        callback: unsafe extern "C" fn(*mut c_void),
    ) {
        super::c::uws_h2_res_cork(response, user, callback)
    }
}
