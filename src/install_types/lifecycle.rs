use bun_core::ZBox;

pub const SCRIPT_NAMES: [&str; 6] = [
    "preinstall",
    "install",
    "postinstall",
    "preprepare",
    "prepare",
    "postprepare",
];

pub const SCRIPT_NAMES_LEN: usize = SCRIPT_NAMES.len();

// PORT NOTE: `Clone` — Zig had borrowed slices so `list.*` was a shallow
// pointer copy. The Rust port owns `cwd`/`package_name`/`items`, but the install
// task store and lifecycle runner need a by-value copy while the original
// allocation in `Store.entries.scripts` stays live for the post-install pass,
// so a deep clone is required.
#[derive(Clone)]
pub struct ScriptsList {
    pub items: [Option<Box<[u8]>>; SCRIPT_NAMES_LEN],
    pub first_index: u8,
    pub total: u8,
    // Zig `stringZ` ([:0]const u8) owned via `allocator.dupeZ`; the commented
    // Zig deinit freed it, while Rust lets this owned buffer drop normally.
    pub cwd: ZBox,
    pub package_name: Box<[u8]>,
}

impl ScriptsList {
    #[inline]
    pub fn first(&self) -> &[u8] {
        if cfg!(debug_assertions) {
            debug_assert!(self.items[self.first_index as usize].is_some());
        }
        self.items[self.first_index as usize].as_ref().unwrap()
    }

    #[inline]
    pub fn script_name(script_index: usize) -> &'static str {
        SCRIPT_NAMES[script_index]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scripts_list_preserves_script_order_and_first_entry() {
        let list = ScriptsList {
            items: [
                None,
                Some(Box::<[u8]>::from(b"bun run install".as_slice())),
                None,
                None,
                None,
                None,
            ],
            first_index: 1,
            total: 1,
            cwd: ZBox::from_bytes(b"/tmp/pkg"),
            package_name: Box::<[u8]>::from(b"pkg".as_slice()),
        };

        assert_eq!(SCRIPT_NAMES[1], "install");
        assert_eq!(ScriptsList::script_name(list.first_index as usize), "install");
        assert_eq!(list.first(), b"bun run install");
    }
}
