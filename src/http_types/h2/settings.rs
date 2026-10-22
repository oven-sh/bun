//! HTTP/2 SETTINGS (RFC 9113 §6.5).

use super::flow_control::MAX_WINDOW_SIZE;
use super::frame::{ErrorCode, FrameError};

pub const ENTRY_SIZE: usize = 6;
pub const DEFAULT_MAX_FRAME_SIZE: u32 = 16_384;
pub const MAX_MAX_FRAME_SIZE: u32 = 0xff_ffff;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u16)]
pub enum SettingId {
    HeaderTableSize = 0x1,
    EnablePush = 0x2,
    MaxConcurrentStreams = 0x3,
    InitialWindowSize = 0x4,
    MaxFrameSize = 0x5,
    MaxHeaderListSize = 0x6,
    /// RFC 8441 §3
    EnableConnectProtocol = 0x8,
    /// RFC 9218 §2.1
    NoRfc7540Priorities = 0x9,
}

impl SettingId {
    /// `None` for an id outside the registry, which §6.5.2 says to ignore.
    pub fn from_u16(value: u16) -> Option<SettingId> {
        Some(match value {
            0x1 => SettingId::HeaderTableSize,
            0x2 => SettingId::EnablePush,
            0x3 => SettingId::MaxConcurrentStreams,
            0x4 => SettingId::InitialWindowSize,
            0x5 => SettingId::MaxFrameSize,
            0x6 => SettingId::MaxHeaderListSize,
            0x8 => SettingId::EnableConnectProtocol,
            0x9 => SettingId::NoRfc7540Priorities,
            _ => return None,
        })
    }
}

/// One endpoint's settings. The defaults are Node's `getDefaultSettings()`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Settings {
    pub header_table_size: u32,
    pub enable_push: bool,
    pub max_concurrent_streams: u32,
    pub initial_window_size: u32,
    pub max_frame_size: u32,
    pub max_header_list_size: u32,
    pub enable_connect_protocol: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            header_table_size: 4_096,
            enable_push: true,
            max_concurrent_streams: u32::MAX,
            initial_window_size: 65_535,
            max_frame_size: DEFAULT_MAX_FRAME_SIZE,
            max_header_list_size: 65_535,
            enable_connect_protocol: false,
        }
    }
}

impl Settings {
    pub fn apply(&mut self, id: SettingId, value: u32) {
        match id {
            SettingId::HeaderTableSize => self.header_table_size = value,
            SettingId::EnablePush => self.enable_push = value != 0,
            SettingId::MaxConcurrentStreams => self.max_concurrent_streams = value,
            SettingId::InitialWindowSize => self.initial_window_size = value,
            SettingId::MaxFrameSize => self.max_frame_size = value,
            SettingId::MaxHeaderListSize => self.max_header_list_size = value,
            SettingId::EnableConnectProtocol => self.enable_connect_protocol = value != 0,
            SettingId::NoRfc7540Priorities => {}
        }
    }
}

/// The connection error for a value outside its range (§6.5.2).
fn range_error(id: u16, value: u32) -> Option<ErrorCode> {
    use SettingId as Id;
    match SettingId::from_u16(id)? {
        Id::EnablePush | Id::EnableConnectProtocol | Id::NoRfc7540Priorities if value > 1 => {
            Some(ErrorCode::PROTOCOL_ERROR)
        }
        Id::InitialWindowSize if value > MAX_WINDOW_SIZE => Some(ErrorCode::FLOW_CONTROL_ERROR),
        Id::MaxFrameSize if !(DEFAULT_MAX_FRAME_SIZE..=MAX_MAX_FRAME_SIZE).contains(&value) => {
            Some(ErrorCode::PROTOCOL_ERROR)
        }
        _ => None,
    }
}

pub fn entry(id: u16, value: u32) -> [u8; ENTRY_SIZE] {
    let [i0, i1] = id.to_be_bytes();
    let [v0, v1, v2, v3] = value.to_be_bytes();
    [i0, i1, v0, v1, v2, v3]
}

/// The `(id, value)` entries of a SETTINGS payload, in wire order. Every value is in range.
#[derive(Clone, Copy)]
pub struct Entries<'a>(&'a [[u8; ENTRY_SIZE]]);

impl<'a> Entries<'a> {
    pub(super) fn parse(payload: &'a [u8], max_entries: usize) -> Result<Self, FrameError> {
        let (entries, rest) = payload.as_chunks::<ENTRY_SIZE>();
        if !rest.is_empty() {
            return Err(FrameError::connection(
                ErrorCode::FRAME_SIZE_ERROR,
                "SETTINGS length is not a multiple of 6",
            ));
        }
        if entries.len() > max_entries {
            return Err(FrameError::connection(
                ErrorCode::ENHANCE_YOUR_CALM,
                "SETTINGS: too many settings entries",
            ));
        }
        let entries = Entries(entries);
        let mut unchecked = entries;
        match unchecked.find_map(|(id, value)| range_error(id, value)) {
            Some(code) => Err(FrameError::connection(code, "SETTINGS value out of range")),
            None => Ok(entries),
        }
    }
}

impl Iterator for Entries<'_> {
    type Item = (u16, u32);

    fn next(&mut self) -> Option<(u16, u32)> {
        let (&[i0, i1, v0, v1, v2, v3], rest) = self.0.split_first()?;
        self.0 = rest;
        Some((
            u16::from_be_bytes([i0, i1]),
            u32::from_be_bytes([v0, v1, v2, v3]),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(entries: &[(u16, u32)], max_entries: usize) -> Result<Vec<(u16, u32)>, ErrorCode> {
        let payload: Vec<u8> = entries.iter().flat_map(|&(id, v)| entry(id, v)).collect();
        match Entries::parse(&payload, max_entries) {
            Ok(parsed) => Ok(parsed.collect()),
            Err(e) => Err(e.code),
        }
    }

    #[test]
    fn entries_round_trip_in_wire_order() {
        let entries = [(0x4, 1), (0x1, 0), (0xf000, u32::MAX), (0x4, 2)];
        assert_eq!(parse(&entries, 4), Ok(entries.to_vec()));
    }

    #[test]
    fn values_out_of_range() {
        assert_eq!(parse(&[(0x2, 2)], 32), Err(ErrorCode::PROTOCOL_ERROR));
        assert_eq!(parse(&[(0x8, 2)], 32), Err(ErrorCode::PROTOCOL_ERROR));
        assert_eq!(
            parse(&[(0x4, 0x8000_0000)], 32),
            Err(ErrorCode::FLOW_CONTROL_ERROR)
        );
        assert_eq!(parse(&[(0x5, 16_383)], 32), Err(ErrorCode::PROTOCOL_ERROR));
        assert_eq!(
            parse(&[(0x5, 0x100_0000)], 32),
            Err(ErrorCode::PROTOCOL_ERROR)
        );
        assert!(parse(&[(0x5, 16_384), (0x2, 1)], 32).is_ok());
    }

    #[test]
    fn the_entry_cap_comes_before_the_values() {
        assert_eq!(
            parse(&[(0x1, 0), (0x2, 2)], 1),
            Err(ErrorCode::ENHANCE_YOUR_CALM)
        );
    }

    #[test]
    fn apply_sets_the_named_setting() {
        let mut settings = Settings::default();
        settings.apply(SettingId::EnablePush, 0);
        settings.apply(SettingId::MaxFrameSize, 20_000);
        assert!(!settings.enable_push);
        assert_eq!(settings.max_frame_size, 20_000);
    }
}
