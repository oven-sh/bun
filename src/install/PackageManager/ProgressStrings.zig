pub const ProgressStrings = struct {
    pub const download_no_emoji_ = "Resolving";
    const download_no_emoji: string = download_no_emoji_ ++ "\n";
    const download_with_emoji: string = download_emoji ++ download_no_emoji_;
    pub const download_emoji: string = "  🔍 ";

    pub const extract_no_emoji_ = "Resolving & extracting";
    const extract_no_emoji: string = extract_no_emoji_ ++ "\n";
    const extract_with_emoji: string = extract_emoji ++ extract_no_emoji_;
    pub const extract_emoji: string = "  🚚 ";

    pub const install_no_emoji_ = "Installing";
    const install_no_emoji: string = install_no_emoji_ ++ "\n";
    const install_with_emoji: string = install_emoji ++ install_no_emoji_;
    pub const install_emoji: string = "  📦 ";

    pub const save_no_emoji_ = "Saving lockfile";
    const save_no_emoji: string = save_no_emoji_;
    const save_with_emoji: string = save_emoji ++ save_no_emoji_;
    pub const save_emoji: string = "  🔒 ";

    pub const script_no_emoji_ = "Running script";
    const script_no_emoji: string = script_no_emoji_ ++ "\n";
    const script_with_emoji: string = script_emoji ++ script_no_emoji_;
    pub const script_emoji: string = "  ⚙️  ";

    pub inline fn download() string {
        return if (Output.enable_ansi_colors_stderr) download_with_emoji else download_no_emoji;
    }

    pub inline fn save() string {
        return if (Output.enable_ansi_colors_stderr) save_with_emoji else save_no_emoji;
    }

    pub inline fn extract() string {
        return if (Output.enable_ansi_colors_stderr) extract_with_emoji else extract_no_emoji;
    }

    pub inline fn install() string {
        return if (Output.enable_ansi_colors_stderr) install_with_emoji else install_no_emoji;
    }

    pub inline fn script() string {
        return if (Output.enable_ansi_colors_stderr) script_with_emoji else script_no_emoji;
    }
};

pub fn setNodeName(
    this: *PackageManager,
    node: *Progress.Node,
    name: string,
    emoji: string,
    comptime is_first: bool,
) void {
    if (Output.enable_ansi_colors_stderr) {
        if (is_first) {
            @memcpy(this.progress_name_buf[0..emoji.len], emoji);
            @memcpy(this.progress_name_buf[emoji.len..][0..name.len], name);
            node.name = this.progress_name_buf[0 .. emoji.len + name.len];
        } else {
            @memcpy(this.progress_name_buf[emoji.len..][0..name.len], name);
            node.name = this.progress_name_buf[0 .. emoji.len + name.len];
        }
    } else {
        @memcpy(this.progress_name_buf[0..name.len], name);
        node.name = this.progress_name_buf[0..name.len];
    }
}

pub fn startProgressBarIfNone(manager: *PackageManager) void {
    if (manager.downloads_node == null) {
        manager.startProgressBar();
    }
}
pub fn startProgressBar(manager: *PackageManager) void {
    manager.progress.supports_ansi_escape_codes = Output.enable_ansi_colors_stderr;
    manager.downloads_node = manager.progress.start(ProgressStrings.download(), 0);
    manager.setNodeName(manager.downloads_node.?, ProgressStrings.download_no_emoji_, ProgressStrings.download_emoji, true);
    manager.downloads_node.?.setEstimatedTotalItems(manager.total_tasks + manager.extracted_count);
    manager.downloads_node.?.setCompletedItems(manager.total_tasks - manager.pendingTaskCount());
    manager.downloads_node.?.activate();
    manager.progress.refresh();
}

pub fn endProgressBar(manager: *PackageManager) void {
    var downloads_node = manager.downloads_node orelse return;
    downloads_node.setEstimatedTotalItems(downloads_node.unprotected_estimated_total_items);
    downloads_node.setCompletedItems(downloads_node.unprotected_estimated_total_items);
    manager.progress.refresh();
    manager.progress.root.end();
    manager.progress = .{};
    manager.downloads_node = null;
}

const string = []const u8;

const bun = @import("bun");
const Output = bun.Output;
const Progress = bun.Progress;
const PackageManager = bun.install.PackageManager;
