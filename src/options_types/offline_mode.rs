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

// ported from: src/options_types/OfflineMode.zig
