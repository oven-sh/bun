use core::sync::atomic::Ordering;

use bun_core::{Output, strings};
use const_format::concatcp;

use crate::bun_progress::Node as ProgressNode;

use super::PackageManager;

pub struct ProgressStrings;

impl ProgressStrings {
    // The base *_NO_EMOJI_ / *_EMOJI consts stay &str because concatcp! requires str
    // inputs; derived consts and fn returns are &[u8].
    pub(crate) const DOWNLOAD_NO_EMOJI_: &'static str = "Resolving";
    const DOWNLOAD_NO_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::DOWNLOAD_NO_EMOJI_, "\n").as_bytes();
    const DOWNLOAD_WITH_EMOJI: &'static [u8] = concatcp!(
        ProgressStrings::DOWNLOAD_EMOJI,
        ProgressStrings::DOWNLOAD_NO_EMOJI_
    )
    .as_bytes();
    pub(crate) const DOWNLOAD_EMOJI: &'static str = "  🔍 ";

    pub(crate) const EXTRACT_EMOJI: &'static str = "  🚚 ";

    pub(crate) const INSTALL_NO_EMOJI_: &'static str = "Installing";
    const INSTALL_NO_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::INSTALL_NO_EMOJI_, "\n").as_bytes();
    const INSTALL_WITH_EMOJI: &'static [u8] = concatcp!(
        ProgressStrings::INSTALL_EMOJI,
        ProgressStrings::INSTALL_NO_EMOJI_
    )
    .as_bytes();
    pub(crate) const INSTALL_EMOJI: &'static str = "  📦 ";

    pub(crate) const SAVE_NO_EMOJI_: &'static str = "Saving lockfile";
    const SAVE_NO_EMOJI: &'static [u8] = ProgressStrings::SAVE_NO_EMOJI_.as_bytes();
    const SAVE_WITH_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::SAVE_EMOJI, ProgressStrings::SAVE_NO_EMOJI_).as_bytes();
    pub(crate) const SAVE_EMOJI: &'static str = "  🔒 ";

    pub(crate) const SCRIPT_NO_EMOJI_: &'static str = "Running script";
    const SCRIPT_NO_EMOJI: &'static [u8] =
        concatcp!(ProgressStrings::SCRIPT_NO_EMOJI_, "\n").as_bytes();
    const SCRIPT_WITH_EMOJI: &'static [u8] = concatcp!(
        ProgressStrings::SCRIPT_EMOJI,
        ProgressStrings::SCRIPT_NO_EMOJI_
    )
    .as_bytes();
    pub(crate) const SCRIPT_EMOJI: &'static str = "  ⚙️  ";

    #[inline]
    pub(crate) fn download() -> &'static [u8] {
        if Output::enable_ansi_colors_stderr() {
            Self::DOWNLOAD_WITH_EMOJI
        } else {
            Self::DOWNLOAD_NO_EMOJI
        }
    }

    #[inline]
    pub(crate) fn save() -> &'static [u8] {
        if Output::enable_ansi_colors_stderr() {
            Self::SAVE_WITH_EMOJI
        } else {
            Self::SAVE_NO_EMOJI
        }
    }

    #[inline]
    pub(crate) fn install() -> &'static [u8] {
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
    /// Writes `emoji` and `name` into `progress_name_buf` and returns the text
    /// for a progress node's `name`. The caller assigns it, because the
    /// downloads node lives inside `self.progress` and must not be borrowed
    /// at the same time as `&mut self`.
    pub(crate) fn progress_node_name<const IS_FIRST: bool>(
        &mut self,
        name: &[u8],
        emoji: &[u8],
    ) -> &'static [u8] {
        let emoji_len = if Output::enable_ansi_colors_stderr() {
            if IS_FIRST {
                self.progress_name_buf[..emoji.len()].copy_from_slice(emoji);
            }
            emoji.len()
        } else {
            0
        };
        // Display-only, so a name longer than the buffer is simply cut short.
        let name =
            strings::truncate_to_char_boundary(name, self.progress_name_buf.len() - emoji_len);
        self.progress_name_buf[emoji_len..][..name.len()].copy_from_slice(name);
        let len = emoji_len + name.len();
        // SAFETY: the result is stored in `self.downloads_node` /
        // `self.scripts_node`, both of which point at storage owned by (or
        // outliving) this `PackageManager` singleton; `progress_name_buf` is an
        // inline field of that same singleton, so the buffer outlives every
        // node that references it and erasing the slice lifetime to `'static`
        // is sound.
        unsafe { bun_ptr::detach_lifetime(&self.progress_name_buf[..len]) }
    }

    pub fn start_progress_bar_if_none(&mut self) {
        if self.downloads_node.is_none() {
            self.start_progress_bar();
        }
    }

    pub(crate) fn start_progress_bar(&mut self) {
        self.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        // `Progress::start` returns `&mut Node` borrowing `self.progress`;
        // decay to a raw ptr immediately so the exclusive borrow ends before we
        // re-borrow `&mut self` for `set_node_name` / `progress.refresh()`.
        let node: *mut ProgressNode = self.progress.start(ProgressStrings::download(), 0);
        self.downloads_node = Some(node);
        let node_name = self.progress_node_name::<true>(
            ProgressStrings::DOWNLOAD_NO_EMOJI_.as_bytes(),
            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
        );
        let estimated = (self.total_tasks + self.extracted_count) as usize;
        let completed = (self.total_tasks - self.pending_task_count()) as usize;
        // `downloads_node` was just stashed above; route through the accessor
        // (single unsafe site) instead of re-dereffing the raw `node` here.
        // Nothing borrows `self` while `dn` is live.
        let dn = self.downloads_node_mut();
        dn.name = node_name;
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
