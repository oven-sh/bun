use bun_core::Output;
use const_format::concatcp;

use crate::bun_progress::NodeId;

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
    pub(crate) fn set_node_name(&self, node: NodeId, name: &[u8], emoji: &[u8]) {
        let node = self.progress.node(node);
        if Output::enable_ansi_colors_stderr() {
            node.set_name(emoji);
            node.append_to_name(name);
        } else {
            node.set_name(name);
        }
    }

    /// Panics unless a progress bar is running.
    pub(crate) fn downloads_node(&self) -> NodeId {
        self.downloads_node.expect("downloads_node active")
    }

    pub(crate) fn start_progress_bar_if_none(&mut self) {
        if self.downloads_node.is_none() {
            self.start_progress_bar();
        }
    }

    pub(crate) fn start_progress_bar(&mut self) {
        self.progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        self.progress.start(b"", 0);
        self.downloads_node = Some(NodeId::Root);
        self.set_node_name(
            NodeId::Root,
            ProgressStrings::DOWNLOAD_NO_EMOJI_.as_bytes(),
            ProgressStrings::DOWNLOAD_EMOJI.as_bytes(),
        );
        let node = self.progress.root();
        node.estimated_total_items
            .set((self.total_tasks.get() + self.extracted_count) as usize);
        node.completed_items
            .set((self.total_tasks.get() - self.pending_task_count()) as usize);
        self.progress.refresh();
    }

    /// For a linker that has `to_install` packages to install.
    pub(crate) fn start_install_progress_bar(&mut self, to_install: usize) {
        let progress = &mut self.progress;
        progress.supports_ansi_escape_codes = Output::enable_ansi_colors_stderr();
        progress.start(b"", 0);
        progress.start_child(NodeId::Downloads, ProgressStrings::download(), 0);
        progress.start_child(NodeId::Install, ProgressStrings::install(), to_install);
        progress.start_child(NodeId::Scripts, ProgressStrings::script(), 0);
        self.downloads_node = Some(NodeId::Downloads);
        self.scripts_node = Some(NodeId::Scripts);
    }

    pub(crate) fn end_progress_bar(&mut self) {
        let Some(node) = self.downloads_node else {
            return;
        };
        let node = self.progress.node(node);
        node.completed_items.set(node.estimated_total_items.get());
        self.progress.refresh();
        self.progress.end();
        self.progress = Default::default();
        self.downloads_node = None;
    }
}
