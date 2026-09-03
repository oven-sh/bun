//! The user-level `.npmrc` and where it lives.

use bun_core::ZStr;
use bun_paths::PathBuffer;
use bun_paths::resolve_path::{self, platform};

/// `$XDG_CONFIG_HOME/.npmrc` when that file exists, else `$HOME/.npmrc`. Shared by the reader and `bun login`.
pub fn user_npmrc_path(buf: &mut PathBuffer) -> Option<&ZStr> {
    let parts = [b"./.npmrc" as &[u8]];
    let mut len: usize = 0;
    if let Some(xdg_dir) = bun_core::env_var::XDG_CONFIG_HOME.get_not_empty() {
        let p =
            resolve_path::join_abs_string_buf_z::<platform::Auto>(xdg_dir, &mut buf[..], &parts);
        if bun_sys::exists_z(p) {
            len = p.len();
        }
    }
    if len == 0 {
        if let Some(home_dir) = bun_core::env_var::HOME.get_not_empty() {
            len = resolve_path::join_abs_string_buf_z::<platform::Auto>(
                home_dir,
                &mut buf[..],
                &parts,
            )
            .len();
        }
    }
    if len == 0 {
        return None;
    }
    // SAFETY: `join_abs_string_buf_z` wrote the NUL at `len`.
    Some(ZStr::from_buf(&buf[..], len))
}
