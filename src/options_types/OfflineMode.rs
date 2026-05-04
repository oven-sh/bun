#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OfflineMode {
    Online,
    Latest,
    Offline,
}

pub static PREFER: phf::Map<&'static [u8], OfflineMode> = phf::phf_map! {
    b"offline" => OfflineMode::Offline,
    b"latest" => OfflineMode::Latest,
    b"online" => OfflineMode::Online,
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/OfflineMode.zig (13 lines)
//   confidence: high
//   todos:      0
//   notes:      ComptimeStringMap → phf::Map; only 3 entries so a plain match would also work
// ──────────────────────────────────────────────────────────────────────────
