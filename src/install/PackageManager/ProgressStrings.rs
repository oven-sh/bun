use core::sync::atomic::Ordering;

use bun_core::Output;
use const_format::concatcp;

use crate::bun_progress::Node as ProgressNode;

use super::PackageManager;

pub struct ProgressStrings;

impl ProgressStrings {
    // The base *_NO_EMOJI_ / *_EMOJI consts stay &str because concatcp! requires str
    // inputs; derived consts and fn returns are &[u8].
    pub const DOWNLOAD_NO_EMOJI_: &'static str = "Resolving";
    const DOWNLOAD_NO_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::DOWNLOAD_NO_EMOJI_, "\n").as_bytes();
    const DOWNLOAD_WITH_EMOJI: &'static [u8] = concatcp!(
        ProgressStrings::DOWNLOAD_EMOJI,
        ProgressStrings::DOWNLOAD_NO_EMOJI_
    )
    .as_bytes();
    pub const DOWNLOAD_EMOJI: &'static str = "  🔍 ";

    pub const EXTRACT_NO_EMOJI_: &'static str = "Resolving & extracting";
    const EXTRACT_NO_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::EXTRACT_NO_EMOJI_, "\n").as_bytes();
    const EXTRACT_WITH_EMOJI: &'static [u8] = concatcp!(
        ProgressStrings::EXTRACT_EMOJI,
        ProgressStrings::EXTRACT_NO_EMOJI_
    )
    .as_bytes();
    pub const EXTRACT_EMOJI: &'static str = "  🚚 ";

    pub const INSTALL_NO_EMOJI_: &'static str = "Installing";
    const INSTALL_NO_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::INSTALL_NO_EMOJI_, "\n").as_bytes();
    const INSTALL_WITH_EMOJI: &'static [u8] = concatcp!(
        ProgressStrings::INSTALL_EMOJI,
        ProgressStrings::INSTALL_NO_EMOJI_
    )
    .as_bytes();
    pub const INSTALL_EMOJI: &'static str = "  📦 ";

    pub const SAVE_NO_EMOJI_: &'static str = "Saving lockfile";
    const SAVE_NO_EMOJI: &'static [u8] = ProgressStrings::SAVE_NO_EMOJI_.as_bytes();
    const SAVE_WITH_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::SAVE_EMOJI, ProgressStrings::SAVE_NO_EMOJI_).as_bytes();
    pub const SAVE_EMOJI: &'static str = "  🔒 ";

    pub const SCRIPT_NO_EMOJI_: &'static str = "Running script";
    const SCRIPT_NO_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::SCRIPT_NO_EMOJI_, "\n").as_bytes();
    const SCRIPT_WITH_EMOJI: &'static [u8] = concatcp!(
        ProgressStrings::SCRIPT_EMOJI,
        ProgressStrings::SCRIPT_NO_EMOJI_
    )
    .as_bytes();
    pub const SCRIPT_EMOJI: &'static str = "  ⚙️  ";

    #[inline]
    pub fn download() -> &'static [u8] {
        if Output::enable_ansi_colors_stderr() {
            Self::DOWNLOAD_WITH_EMOJI
        } else {
            Self::DOWNLOAD_NO_EMOJI
        }
    }

    #[inline]
    pub fn save() -> &'static [u8] {
        if Output::enable_ansi_colors_stderr() {
            Self::SAVE_WITH_EMOJI
        } else {
            Self::SAVE_NO_EMOJI
        }
    }

    #[inline]
    pub fn extract() -> &'static [u8] {
        if Output::enable_ansi_colors_stderr() {
            Self::EXTRACT_WITH_EMOJI
        } else {
            Self::EXTRACT_NO_EMOJI
        }
    }

    #[inline]
    pub fn install() -> &'static [u8] {
        if Output::enable_ansi_colors_stderr() {
            Self::INSTALL_WITH_EMOJI
        } else {
            Self::INSTALL_NO_EMOJI
        }
    }

    #[inline]
    pub fn script() -> &'static [u8] {
        if Output::enable_ansi_colors_stderr() {
            Self::SCRIPT_WITH_EMOJI
        } else {
            Self::SCRIPT_NO_EMOJI
        }
    }
}

impl PackageManager {
    /// Fill `progress_name_buf` with `emoji` + `name`; returns the byte length.
    fn write_progress_name<const IS_FIRST: bool>(&mut self, name: &[u8], emoji: &[u8]) -> usize {
        if Output::enable_ansi_colors_stderr() {
            if IS_FIRST {
                self.progress_name_buf[..emoji.len()].copy_from_slice(emoji);
            }
            self.progress_name_buf[emoji.len()..][..name.len()].copy_from_slice(name);
            emoji.len() + name.len()
        } else {
            self.progress_name_buf[..name.len()].copy_from_slice(name);
            name.len()
        }
    }

    /// Name `downloads_node`. Fills the buffer and re-derives the node after, so
    /// no `&mut ProgressNode` is live alongside the `&mut self` it aliases —
    /// `downloads_node` points at `self.progress.root`.
    pub fn set_downloads_node_name<const IS_FIRST: bool>(&mut self, name: &[u8], emoji: &[u8]) {
        let len = self.write_progress_name::<IS_FIRST>(name, emoji);
        // SAFETY: `progress_name_buf` is an inline field of the leaked singleton,
        // so it outlives every node that references it.
        let named: &'static [u8] =
            unsafe { bun_ptr::detach_lifetime(&self.progress_name_buf[..len]) };
        self.downloads_node_mut().name = named;
    }

    pub fn set_node_name<const IS_FIRST: bool>(
        &mut self,
        node: &mut ProgressNode,
        name: &[u8],
        emoji: &[u8],
    ) {
        let len = self.write_progress_name::<IS_FIRST>(name, emoji);
        // SAFETY: `progress_name_buf` is an inline field of the leaked singleton,
        // so it outlives every node that references it.
        node.name = unsafe { bun_ptr::detach_lifetime(&self.progress_name_buf[..len]) };
    }

    pub fn start_progress_bar_if_none(&mut self) {
        if self.downloads_node.is_none() {
            self.start_progress_bar();
        }
    }

    pub fn start_progress_bar(&mut self) {
        self.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        // `Progress::start` returns `&mut Node` borrowing `self.progress`;
        // decay to a raw ptr immediately so the exclusive borrow ends before we
        // re-borrow `&mut self`.
        let node: *mut ProgressNode = self.progress.start(ProgressStrings::download(), 0);
        self.downloads_node = Some(node);
        self.set_downloads_node_name::<true>(
            ProgressStrings::DOWNLOAD_NO_EMOJI_.as_bytes(),
            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
        );
        let estimated = (self.total_tasks + self.extracted_count) as usize;
        let completed = (self.total_tasks - self.pending_task_count()) as usize;
        let dn = self.downloads_node_mut();
        dn.set_estimated_total_items(estimated);
        dn.set_completed_items(completed);
        dn.activate();
        self.progress.refresh();
    }

    pub fn end_progress_bar(&mut self) {
        if self.downloads_node.is_none() {
            return;
        }
        // Route through the accessor (single unsafe site) instead of a raw
        // `(*downloads_node)` deref here.
        let dn = self.downloads_node_mut();
        let total = dn.unprotected_estimated_total_items.load(Ordering::Relaxed);
        dn.set_estimated_total_items(total);
        dn.set_completed_items(total);
        self.progress.refresh();
        self.progress.root.end();
        self.progress = Default::default();
        self.downloads_node = None;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Free-function re-export surface. Thin shims over the
// `impl PackageManager` bodies above so `pub use progress_mod::{...}` in
// `PackageManager.rs` resolves (matching the directories/enqueue pattern).
// ──────────────────────────────────────────────────────────────────────────

#[inline]
pub fn set_node_name<const IS_FIRST: bool>(
    this: &mut PackageManager,
    node: &mut ProgressNode,
    name: &[u8],
    emoji: &[u8],
) {
    this.set_node_name::<IS_FIRST>(node, name, emoji)
}

#[inline]
pub fn start_progress_bar_if_none(manager: &mut PackageManager) {
    manager.start_progress_bar_if_none()
}

#[inline]
pub fn start_progress_bar(manager: &mut PackageManager) {
    manager.start_progress_bar()
}

#[inline]
pub fn end_progress_bar(manager: &mut PackageManager) {
    manager.end_progress_bar()
}
