#[allow(non_camel_case_types)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum GlobalCache {
    allow_install,
    read_only,
    auto,
    force,
    fallback,
    disable,
}

impl GlobalCache {
    pub const MAP: phf::Map<&'static [u8], GlobalCache> = phf::phf_map! {
        b"auto" => GlobalCache::auto,
        b"force" => GlobalCache::force,
        b"disable" => GlobalCache::disable,
        b"fallback" => GlobalCache::fallback,
    };

    pub fn allow_version_specifier(self) -> bool {
        self == GlobalCache::force
    }

    pub fn can_use(self, has_a_node_modules_folder: bool) -> bool {
        // When there is a node_modules folder, we default to false
        // When there is NOT a node_modules folder, we default to true
        // That is the difference between these two branches.
        if has_a_node_modules_folder {
            match self {
                GlobalCache::fallback | GlobalCache::allow_install | GlobalCache::force => true,
                GlobalCache::read_only | GlobalCache::disable | GlobalCache::auto => false,
            }
        } else {
            match self {
                GlobalCache::read_only
                | GlobalCache::fallback
                | GlobalCache::allow_install
                | GlobalCache::auto
                | GlobalCache::force => true,
                GlobalCache::disable => false,
            }
        }
    }

    pub fn is_enabled(self) -> bool {
        self != GlobalCache::disable
    }

    pub fn can_install(self) -> bool {
        match self {
            GlobalCache::auto
            | GlobalCache::allow_install
            | GlobalCache::force
            | GlobalCache::fallback => true,
            _ => false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/options_types/GlobalCache.zig (49 lines)
//   confidence: high
//   todos:      0
//   notes:      MAP is an associated const phf::Map; if phf const-init is rejected, hoist to module-level `pub static`.
// ──────────────────────────────────────────────────────────────────────────
