#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum OfflineMode {
    Online,
    Latest,
    Offline,
}

bun_core::comptime_string_map! {
    pub static PREFER: OfflineMode = {
        b"offline" => OfflineMode::Offline,
        b"latest" => OfflineMode::Latest,
        b"online" => OfflineMode::Online,
    };
}
