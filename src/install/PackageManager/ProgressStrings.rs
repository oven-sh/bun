use bun_core::Output;
use bun_core::Progress;
use const_format::concatcp;

use super::PackageManager;

pub struct ProgressStrings;

impl ProgressStrings {
    pub const DOWNLOAD_NO_EMOJI_: &'static str = "Resolving";
    const DOWNLOAD_NO_EMOJI: &'static str = concatcp!(ProgressStrings::DOWNLOAD_NO_EMOJI_, "\n");
    const DOWNLOAD_WITH_EMOJI: &'static str =
        concatcp!(ProgressStrings::DOWNLOAD_EMOJI, ProgressStrings::DOWNLOAD_NO_EMOJI_);
    pub const DOWNLOAD_EMOJI: &'static str = "  🔍 ";

    pub const EXTRACT_NO_EMOJI_: &'static str = "Resolving & extracting";
    const EXTRACT_NO_EMOJI: &'static str = concatcp!(ProgressStrings::EXTRACT_NO_EMOJI_, "\n");
    const EXTRACT_WITH_EMOJI: &'static str =
        concatcp!(ProgressStrings::EXTRACT_EMOJI, ProgressStrings::EXTRACT_NO_EMOJI_);
    pub const EXTRACT_EMOJI: &'static str = "  🚚 ";

    pub const INSTALL_NO_EMOJI_: &'static str = "Installing";
    const INSTALL_NO_EMOJI: &'static str = concatcp!(ProgressStrings::INSTALL_NO_EMOJI_, "\n");
    const INSTALL_WITH_EMOJI: &'static str =
        concatcp!(ProgressStrings::INSTALL_EMOJI, ProgressStrings::INSTALL_NO_EMOJI_);
    pub const INSTALL_EMOJI: &'static str = "  📦 ";

    pub const SAVE_NO_EMOJI_: &'static str = "Saving lockfile";
    const SAVE_NO_EMOJI: &'static str = ProgressStrings::SAVE_NO_EMOJI_;
    const SAVE_WITH_EMOJI: &'static str =
        concatcp!(ProgressStrings::SAVE_EMOJI, ProgressStrings::SAVE_NO_EMOJI_);
    pub const SAVE_EMOJI: &'static str = "  🔒 ";

    pub const SCRIPT_NO_EMOJI_: &'static str = "Running script";
    const SCRIPT_NO_EMOJI: &'static str = concatcp!(ProgressStrings::SCRIPT_NO_EMOJI_, "\n");
    const SCRIPT_WITH_EMOJI: &'static str =
        concatcp!(ProgressStrings::SCRIPT_EMOJI, ProgressStrings::SCRIPT_NO_EMOJI_);
    pub const SCRIPT_EMOJI: &'static str = "  ⚙️  ";

    #[inline]
    pub fn download() -> &'static str {
        if Output::enable_ansi_colors_stderr() {
            Self::DOWNLOAD_WITH_EMOJI
        } else {
            Self::DOWNLOAD_NO_EMOJI
        }
    }

    #[inline]
    pub fn save() -> &'static str {
        if Output::enable_ansi_colors_stderr() {
            Self::SAVE_WITH_EMOJI
        } else {
            Self::SAVE_NO_EMOJI
        }
    }

    #[inline]
    pub fn extract() -> &'static str {
        if Output::enable_ansi_colors_stderr() {
            Self::EXTRACT_WITH_EMOJI
        } else {
            Self::EXTRACT_NO_EMOJI
        }
    }

    #[inline]
    pub fn install() -> &'static str {
        if Output::enable_ansi_colors_stderr() {
            Self::INSTALL_WITH_EMOJI
        } else {
            Self::INSTALL_NO_EMOJI
        }
    }

    #[inline]
    pub fn script() -> &'static str {
        if Output::enable_ansi_colors_stderr() {
            Self::SCRIPT_WITH_EMOJI
        } else {
            Self::SCRIPT_NO_EMOJI
        }
    }
}

impl PackageManager {
    pub fn set_node_name<const IS_FIRST: bool>(
        &mut self,
        node: &mut Progress::Node,
        name: &str,
        emoji: &str,
    ) {
        let name = name.as_bytes();
        let emoji = emoji.as_bytes();
        if Output::enable_ansi_colors_stderr() {
            if IS_FIRST {
                self.progress_name_buf[..emoji.len()].copy_from_slice(emoji);
                self.progress_name_buf[emoji.len()..][..name.len()].copy_from_slice(name);
                // TODO(port): self-referential borrow — node.name points into self.progress_name_buf
                node.name = &self.progress_name_buf[..emoji.len() + name.len()];
            } else {
                self.progress_name_buf[emoji.len()..][..name.len()].copy_from_slice(name);
                // TODO(port): self-referential borrow — node.name points into self.progress_name_buf
                node.name = &self.progress_name_buf[..emoji.len() + name.len()];
            }
        } else {
            self.progress_name_buf[..name.len()].copy_from_slice(name);
            // TODO(port): self-referential borrow — node.name points into self.progress_name_buf
            node.name = &self.progress_name_buf[..name.len()];
        }
    }

    pub fn start_progress_bar_if_none(&mut self) {
        if self.downloads_node.is_none() {
            self.start_progress_bar();
        }
    }

    pub fn start_progress_bar(&mut self) {
        self.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        self.downloads_node = Some(self.progress.start(ProgressStrings::download(), 0));
        // PORT NOTE: reshaped for borrowck — Zig calls self.setNodeName(self.downloads_node.?, ...)
        // which would be an overlapping &mut self borrow here.
        // TODO(port): resolve overlapping borrow of self.downloads_node vs &mut self
        self.set_node_name::<true>(
            self.downloads_node.as_mut().unwrap(),
            ProgressStrings::DOWNLOAD_NO_EMOJI_,
            ProgressStrings::DOWNLOAD_EMOJI,
        );
        let total_tasks = self.total_tasks;
        let extracted_count = self.extracted_count;
        let pending = self.pending_task_count();
        let node = self.downloads_node.as_mut().unwrap();
        node.set_estimated_total_items(total_tasks + extracted_count);
        node.set_completed_items(total_tasks - pending);
        node.activate();
        self.progress.refresh();
    }

    pub fn end_progress_bar(&mut self) {
        let Some(downloads_node) = self.downloads_node.as_mut() else {
            return;
        };
        downloads_node.set_estimated_total_items(downloads_node.unprotected_estimated_total_items);
        downloads_node.set_completed_items(downloads_node.unprotected_estimated_total_items);
        self.progress.refresh();
        self.progress.root.end();
        self.progress = Progress::default();
        self.downloads_node = None;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/install/PackageManager/ProgressStrings.zig (100 lines)
//   confidence: medium
//   todos:      4
//   notes:      node.name = &self.progress_name_buf[..] is self-referential; set_node_name call in start_progress_bar has overlapping &mut self — Phase B may need raw ptr or restructure Progress::Node ownership
// ──────────────────────────────────────────────────────────────────────────
