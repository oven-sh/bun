//! HTTP/2 SETTINGS (RFC 9113 §6.5). Pure: value semantics, range validation, on-wire packing,
//! and the INITIAL_WINDOW_SIZE retroactive-window delta. Part of the from-scratch rewrite.

#![allow(dead_code)]

use super::wire::{self, ErrorCode, SettingId};

/// Logical SETTINGS values. Defaults match Node v27 `getDefaultSettings()` exactly
/// (note `max_concurrent_streams` = 2^32-1).
#[derive(Clone, Copy, Debug)]
pub struct Settings {
    pub header_table_size: u32,
    pub enable_push: u32, // 0/1
    pub max_concurrent_streams: u32,
    pub initial_window_size: u32,
    pub max_frame_size: u32,
    pub max_header_list_size: u32,
    pub enable_connect_protocol: u32, // 0/1
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            header_table_size: 4_096,
            enable_push: 1,
            max_concurrent_streams: 4_294_967_295, // 2^32-1 (Node default)
            initial_window_size: 65_535,
            max_frame_size: 16_384,
            max_header_list_size: 65_535,
            enable_connect_protocol: 0,
        }
    }
}

impl Settings {
    pub fn apply(&mut self, id: SettingId, value: u32) {
        match id {
            SettingId::HeaderTableSize => self.header_table_size = value,
            SettingId::EnablePush => self.enable_push = value,
            SettingId::MaxConcurrentStreams => self.max_concurrent_streams = value,
            SettingId::InitialWindowSize => self.initial_window_size = value,
            SettingId::MaxFrameSize => self.max_frame_size = value,
            SettingId::MaxHeaderListSize => self.max_header_list_size = value,
            SettingId::EnableConnectProtocol => self.enable_connect_protocol = value,
            SettingId::NoRfc7540Priorities => {}
        }
    }
}

/// §6.5.2 single-value range validation. `Some(code)` = connection error to send, `None` = ok.
pub fn validate_unit(id: u16, value: u32) -> Option<ErrorCode> {
    match SettingId::from_u16(id) {
        // EnablePush (§6.5.2), EnableConnectProtocol (RFC 8441 §3), and NoRfc7540Priorities
        // (RFC 9218 §2.1) are boolean-valued: anything other than 0/1 is a PROTOCOL_ERROR.
        Some(SettingId::EnablePush)
        | Some(SettingId::EnableConnectProtocol)
        | Some(SettingId::NoRfc7540Priorities)
            if value > 1 =>
        {
            Some(ErrorCode::ProtocolError)
        }
        Some(SettingId::InitialWindowSize) if value > wire::MAX_WINDOW_SIZE => {
            Some(ErrorCode::FlowControlError)
        }
        Some(SettingId::MaxFrameSize)
            if value < wire::MAX_FRAME_SIZE_LOWER || value > wire::MAX_FRAME_SIZE_UPPER =>
        {
            Some(ErrorCode::ProtocolError)
        }
        _ => None, // unknown settings are ignored (§6.5.2)
    }
}

/// Validate every 6-byte unit in a received SETTINGS payload; returns the first violation.
pub fn validate_payload(payload: &[u8]) -> Option<ErrorCode> {
    let mut i = 0;
    while i + 6 <= payload.len() {
        let id = u16::from_be_bytes([payload[i], payload[i + 1]]);
        let value = u32::from_be_bytes([
            payload[i + 2],
            payload[i + 3],
            payload[i + 4],
            payload[i + 5],
        ]);
        if let Some(code) = validate_unit(id, value) {
            return Some(code);
        }
        i += 6;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enable_push_out_of_range() {
        assert_eq!(
            validate_unit(SettingId::EnablePush as u16, 2),
            Some(ErrorCode::ProtocolError)
        );
        assert_eq!(validate_unit(SettingId::EnablePush as u16, 1), None);
    }

    #[test]
    fn initial_window_overflow() {
        assert_eq!(
            validate_unit(SettingId::InitialWindowSize as u16, 0x8000_0000),
            Some(ErrorCode::FlowControlError)
        );
    }

    #[test]
    fn max_frame_size_bounds() {
        assert_eq!(
            validate_unit(SettingId::MaxFrameSize as u16, 1000),
            Some(ErrorCode::ProtocolError)
        );
        assert_eq!(validate_unit(SettingId::MaxFrameSize as u16, 16_384), None);
    }
}
