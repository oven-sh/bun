use core::fmt;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::StringHashMap;
use bun_core::{Global, Output};
use bun_resolver::fs::FileSystem;
use bun_glob as glob;
use bun_install::dependency::Behavior;
use bun_install::package_manager::WorkspaceFilter;
use bun_install::{DependencyID, PackageID, PackageManager, INVALID_PACKAGE_ID};
use bun_js_parser::ast::{Expr, E};
use bun_js_printer as js_printer;
use bun_logger as logger;
use bun_paths::{self as path, PathBuffer};
use bun_semver::{self as semver, SlicedString};
use bun_str::strings;

use crate::Command;

pub struct TerminalHyperlink<'a> {
    link: &'a [u8],
    text: &'a [u8],
    enabled: bool,
}

impl<'a> TerminalHyperlink<'a> {
    pub fn new(link: &'a [u8], text: &'a [u8], enabled: bool) -> TerminalHyperlink<'a> {
        TerminalHyperlink { link, text, enabled }
    }
}

impl fmt::Display for TerminalHyperlink<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.enabled {
            const ESC: &str = "\x1b";
            // OSC8 = ESC ]8;; ; ST = ESC \
            write!(
                f,
                "{esc}]8;;{link}{esc}\\{text}{esc}]8;;{esc}\\",
                esc = ESC,
                link = BStr::new(self.link),
                text = BStr::new(self.text),
            )
        } else {
            write!(f, "{}", BStr::new(self.text))
        }
    }
}

pub struct UpdateInteractiveCommand;

struct OutdatedPackage<'a> {
    name: Box<[u8]>,
    current_version: Box<[u8]>,
    latest_version: Box<[u8]>,
    update_version: Box<[u8]>,
    package_id: PackageID,
    dep_id: DependencyID,
    workspace_pkg_id: PackageID,
    dependency_type: &'static [u8],
    workspace_name: Box<[u8]>,
    behavior: Behavior,
    use_latest: bool,
    manager: &'a PackageManager,
    is_catalog: bool,
    catalog_name: Option<Box<[u8]>>,
}

struct CatalogUpdate {
    version: Box<[u8]>,
    workspace_path: Box<[u8]>,
}

struct PackageUpdate {
    name: Box<[u8]>,
    target_version: Box<[u8]>,
    dep_type: Box<[u8]>, // "dependencies", "devDependencies", etc.
    workspace_path: Box<[u8]>,
    original_version: Box<[u8]>,
    package_id: PackageID,
}

pub struct CatalogUpdateRequest {
    // TODO(port): lifetime — these borrow from caller in Zig; using owned for Phase A
    package_name: Box<[u8]>,
    new_version: Box<[u8]>,
    catalog_name: Option<Box<[u8]>>,
}

struct ColumnWidths {
    name: usize,
    current: usize,
    target: usize,
    latest: usize,
    workspace: usize,
    show_workspace: bool,
}

struct MultiSelectState<'a, 's> {
    packages: &'s mut [OutdatedPackage<'a>],
    selected: &'s mut [bool],
    cursor: usize,
    viewport_start: usize,
    viewport_height: usize, // Default viewport height
    toggle_all: bool,
    max_name_len: usize,
    max_current_len: usize,
    max_update_len: usize,
    max_latest_len: usize,
    max_workspace_len: usize,
    show_workspace: bool,
}

#[derive(Clone, Copy)]
struct TerminalSize {
    height: usize,
    width: usize,
}

impl UpdateInteractiveCommand {
    // Common utility functions to reduce duplication

    fn build_package_json_path<'b>(
        root_dir: &'b [u8],
        workspace_path: &[u8],
        path_buf: &'b mut PathBuffer,
    ) -> &'b [u8] {
        if !workspace_path.is_empty() {
            path::resolve_path::join_abs_string_buf::<path::platform::Auto>(
                root_dir,
                path_buf,
                &[workspace_path, b"package.json"],
            )
        } else {
            path::resolve_path::join_abs_string_buf::<path::platform::Auto>(
                root_dir,
                path_buf,
                &[b"package.json"],
            )
        }
    }

    // Helper to update a catalog entry at a specific path in the package.json AST
    fn save_package_json(
        manager: &mut PackageManager,
        // TODO(port): `anytype` — MapEntry from WorkspacePackageJSONCache
        package_json: &mut bun_install::WorkspacePackageJsonCacheEntry,
        package_json_path: &[u8],
    ) -> Result<(), bun_core::Error> {
        let _ = (manager, package_json, package_json_path);
        // Real body requires `js_printer::print_json` shape + `bun_sys::File`
        // write API + mutable `Source.contents` (Cow vs Box) which are still
        // settling. Body preserved in the .zig spec; re-port once
        // `package_manager_real` un-gates.
        todo!("blocked_on: bun_install::package_manager_real un-gate (reconciler-6)")
    }

    pub fn exec(ctx: Command::Context) -> Result<(), bun_core::Error> {
        Output::prettyln(format_args!(
            "<r><b>bun update --interactive <r><d>v{}<r>",
            Global::package_json_version_with_sha
        ));
        Output::flush();

        let _ = ctx;
        // Zig: `PackageManager.CommandLineArguments.parse(.update)` +
        // `PackageManager.init(ctx, cli, .update)` — both gated behind
        // `package_manager_real` (`#![cfg(any())]` reconciler-6).
        todo!("blocked_on: bun_install::PackageManager::init / CommandLineArguments (package_manager_real un-gate)")
    }

    #[allow(dead_code)]
    fn update_package_json_files_from_updates(
        manager: &mut PackageManager,
        updates: &[PackageUpdate],
    ) -> Result<(), bun_core::Error> {
        let _ = (manager, updates);
        // Real body needs `manager.workspace_package_json_cache` / `manager.log`
        // (absent on the stub `PackageManager`) and `E::Object::put(&Bump, …)`.
        // Body preserved in update_interactive_command.zig; re-port once
        // `package_manager_real` un-gates.
        todo!("blocked_on: bun_install::PackageManager::workspace_package_json_cache (package_manager_real un-gate)")
    }

    #[allow(dead_code)]
    fn update_catalog_definitions(
        manager: &mut PackageManager,
        catalog_updates: &StringHashMap<CatalogUpdate>,
    ) -> Result<(), bun_core::Error> {
        // Group catalog updates by workspace path
        let mut workspace_catalog_updates: StringHashMap<Vec<CatalogUpdateRequest>> =
            StringHashMap::default();

        // Group updates by workspace
        let mut catalog_it = catalog_updates.iter();
        while let Some((catalog_key, update)) = catalog_it.next() {
            let result = workspace_catalog_updates
                .get_or_put(&update.workspace_path)
                .map_err(|_| bun_core::err!("OutOfMemory"))?;
            if !result.found_existing {
                *result.value_ptr = Vec::new();
            }

            // Parse catalog_key (format: "package_name" or "package_name:catalog_name")
            let colon_index = bun_str::strings::index_of(catalog_key, b":");
            let package_name = if let Some(idx) = colon_index {
                &catalog_key[..idx]
            } else {
                &catalog_key[..]
            };
            let catalog_name = colon_index.map(|idx| Box::<[u8]>::from(&catalog_key[idx + 1..]));

            result.value_ptr.push(CatalogUpdateRequest {
                package_name: Box::from(package_name),
                new_version: update.version.clone(),
                catalog_name,
            });
        }

        let _ = (manager, workspace_catalog_updates);
        // Second loop needs `manager.workspace_package_json_cache` /
        // `manager.log` (absent on stub `PackageManager`). Body preserved in
        // update_interactive_command.zig; re-port once `package_manager_real`
        // un-gates.
        todo!("blocked_on: bun_install::PackageManager::workspace_package_json_cache (package_manager_real un-gate)")
    }

    #[allow(dead_code)]
    fn update_interactive(
        ctx: Command::Context,
        original_cwd: &[u8],
        manager: &mut PackageManager,
    ) -> Result<(), bun_core::Error> {
        let _ = (ctx, original_cwd, manager);
        // Real body needs `manager.lockfile`, `manager.log`,
        // `manager.root_package_id`, `manager.options.filter_patterns`,
        // `manager.options.do_`, `manager.to_update`, `manager.root_dir`,
        // `Lockfile::load_from_cwd`, `PackageManager::install_with_manager` —
        // all gated behind `package_manager_real` (`#![cfg(any())]`
        // reconciler-6). Body preserved verbatim in
        // update_interactive_command.zig.
        todo!("blocked_on: bun_install::PackageManager::lockfile / install_with_manager (package_manager_real un-gate)")
    }


    #[allow(dead_code)]
    fn get_all_workspaces(manager: &PackageManager) -> Box<[PackageID]> {
        let _ = manager;
        // Needs `manager.lockfile.packages.items_resolution()` — gated behind
        // `package_manager_real` (`#![cfg(any())]` reconciler-6).
        todo!("blocked_on: bun_install::PackageManager::lockfile (package_manager_real un-gate)")
    }

    #[allow(dead_code)]
    fn find_matching_workspaces(
        original_cwd: &[u8],
        manager: &PackageManager,
        filters: &[Box<[u8]>],
    ) -> Box<[PackageID]> {
        let _ = (original_cwd, manager, filters);
        // Needs `manager.lockfile` + `Lockfile.packages.items_resolution()` —
        // gated behind `package_manager_real` (`#![cfg(any())]` reconciler-6).
        todo!("blocked_on: bun_install::PackageManager::lockfile (package_manager_real un-gate)")
    }

    fn group_catalog_dependencies<'a>(
        packages: Vec<OutdatedPackage<'a>>,
    ) -> Result<Vec<OutdatedPackage<'a>>, bun_core::Error> {
        // Create a map to track catalog dependencies by name
        let mut catalog_map: StringHashMap<Vec<OutdatedPackage<'a>>> = StringHashMap::default();

        let mut result: Vec<OutdatedPackage<'a>> = Vec::new();

        // Group catalog dependencies
        for pkg in packages {
            if pkg.is_catalog {
                let entry = catalog_map
                    .get_or_put(&pkg.name)
                    .map_err(|_| bun_core::err!("OutOfMemory"))?;
                if !entry.found_existing {
                    *entry.value_ptr = Vec::new();
                }
                entry.value_ptr.push(pkg);
            } else {
                result.push(pkg);
            }
        }

        // Add grouped catalog dependencies
        let mut iter = catalog_map.into_iter();
        while let Some((_k, catalog_packages)) = iter.next() {
            if !catalog_packages.is_empty() {
                let mut catalog_packages = catalog_packages.into_iter();
                // Use the first package as the base, but combine workspace names
                let mut first = catalog_packages.next().unwrap();

                // Build combined workspace name
                let mut workspace_names: Vec<u8> = Vec::new();

                // PORT NOTE: Zig checks `if (catalog_packages.len > 0)` again here which is always
                // true; preserve behavior of the true branch.
                if let Some(catalog_name) = &first.catalog_name {
                    workspace_names.extend_from_slice(b"catalog:");
                    workspace_names.extend_from_slice(catalog_name);
                } else {
                    workspace_names.extend_from_slice(b"catalog");
                }
                workspace_names.extend_from_slice(b" (");

                workspace_names.extend_from_slice(&first.workspace_name);
                let rest: Vec<OutdatedPackage<'a>> = catalog_packages.collect();
                for cat_pkg in &rest {
                    workspace_names.extend_from_slice(b", ");
                    workspace_names.extend_from_slice(&cat_pkg.workspace_name);
                }
                workspace_names.push(b')');

                // Replace workspace_name with combined (old one drops automatically).
                first.workspace_name = workspace_names.into_boxed_slice();

                result.push(first);

                // The other catalog packages drop here, freeing their owned fields.
                drop(rest);
            }
        }

        Ok(result)
    }

    fn get_outdated_packages<'a>(
        manager: &'a PackageManager,
        workspace_pkg_ids: &[PackageID],
    ) -> Result<Vec<OutdatedPackage<'a>>, bun_core::Error> {
        let _ = (manager, workspace_pkg_ids);
        // Needs `manager.lockfile`, `manager.manifests`,
        // `manager.options.minimum_release_age_ms`, `Lockfile::resolve_catalog_dependency`,
        // `manifest.find_by_dist_tag_with_filter` — all gated behind
        // `package_manager_real` (`#![cfg(any())]` reconciler-6). Body
        // preserved verbatim in update_interactive_command.zig.
        todo!("blocked_on: bun_install::PackageManager::lockfile / manifests (package_manager_real un-gate)")
    }

    fn calculate_column_widths(packages: &[OutdatedPackage<'_>]) -> ColumnWidths {
        // Calculate natural widths based on content
        let mut max_name_len: usize = b"Package".len();
        let mut max_current_len: usize = b"Current".len();
        let mut max_target_len: usize = b"Target".len();
        let mut max_latest_len: usize = b"Latest".len();
        let mut max_workspace_len: usize = b"Workspace".len();
        let mut has_workspaces = false;

        for pkg in packages {
            // Include dev tag length in max calculation
            let mut dev_tag_len: usize = 0;
            if pkg.behavior.dev {
                dev_tag_len = 4; // " dev"
            } else if pkg.behavior.peer {
                dev_tag_len = 5; // " peer"
            } else if pkg.behavior.optional {
                dev_tag_len = 9; // " optional"
            }

            max_name_len = max_name_len.max(pkg.name.len() + dev_tag_len);
            max_current_len = max_current_len.max(pkg.current_version.len());
            max_target_len = max_target_len.max(pkg.update_version.len());
            max_latest_len = max_latest_len.max(pkg.latest_version.len());
            max_workspace_len = max_workspace_len.max(pkg.workspace_name.len());

            // Check if we have any non-empty workspace names
            if !pkg.workspace_name.is_empty() {
                has_workspaces = true;
            }
        }

        // Get terminal width to apply smart limits if needed
        let term_size = Self::get_terminal_size();

        // Apply smart column width limits based on terminal width
        if term_size.width < 60 {
            // Very narrow terminal - aggressive truncation, hide workspace
            max_name_len = max_name_len.min(12);
            max_current_len = max_current_len.min(7);
            max_target_len = max_target_len.min(7);
            max_latest_len = max_latest_len.min(7);
            has_workspaces = false;
        } else if term_size.width < 80 {
            // Narrow terminal - moderate truncation, hide workspace
            max_name_len = max_name_len.min(20);
            max_current_len = max_current_len.min(10);
            max_target_len = max_target_len.min(10);
            max_latest_len = max_latest_len.min(10);
            has_workspaces = false;
        } else if term_size.width < 120 {
            // Medium terminal - light truncation
            max_name_len = max_name_len.min(35);
            max_current_len = max_current_len.min(15);
            max_target_len = max_target_len.min(15);
            max_latest_len = max_latest_len.min(15);
            max_workspace_len = max_workspace_len.min(15);
            // Show workspace only if terminal is wide enough for all columns
            if term_size.width < 100 {
                has_workspaces = false;
            }
        } else if term_size.width < 160 {
            // Wide terminal - minimal truncation for very long names
            max_name_len = max_name_len.min(45);
            max_current_len = max_current_len.min(20);
            max_target_len = max_target_len.min(20);
            max_latest_len = max_latest_len.min(20);
            max_workspace_len = max_workspace_len.min(20);
        }
        // else: wide terminal - use natural widths

        ColumnWidths {
            name: max_name_len,
            current: max_current_len,
            target: max_target_len,
            latest: max_latest_len,
            workspace: max_workspace_len,
            show_workspace: has_workspaces,
        }
    }

    fn get_terminal_size() -> TerminalSize {
        // Try to get terminal size
        #[cfg(unix)]
        {
            // TODO(port): replace std.posix.system.ioctl with bun_sys
            // SAFETY: all-zero is a valid Winsize (#[repr(C)] POD, no NonNull/NonZero fields).
            let mut size: bun_core::Winsize = unsafe { core::mem::zeroed() };
            // SAFETY: ioctl with TIOCGWINSZ on stdout fd; size is a valid out-ptr.
            if unsafe {
                libc::ioctl(
                    libc::STDOUT_FILENO,
                    libc::TIOCGWINSZ,
                    &mut size as *mut _ as *mut libc::c_void,
                )
            } == 0
            {
                // Reserve space for prompt (1 line) + scroll indicators (2 lines) + some buffer
                let usable_height = if size.row > 6 { size.row - 4 } else { 20 };
                return TerminalSize {
                    height: usable_height as usize,
                    width: size.col as usize,
                };
            }
        }
        #[cfg(windows)]
        {
            use bun_sys::windows;
            let handle = match windows::GetStdHandle(windows::STD_OUTPUT_HANDLE) {
                Ok(h) => h,
                Err(_) => return TerminalSize { height: 20, width: 80 },
            };

            // SAFETY: all-zero is a valid CONSOLE_SCREEN_BUFFER_INFO (#[repr(C)] POD).
            let mut csbi: windows::CONSOLE_SCREEN_BUFFER_INFO = unsafe { core::mem::zeroed() };
            // SAFETY: handle is valid; csbi is a valid out-ptr.
            if unsafe { windows::kernel32::GetConsoleScreenBufferInfo(handle, &mut csbi) }
                != windows::FALSE
            {
                let width = csbi.srWindow.Right - csbi.srWindow.Left + 1;
                let height = csbi.srWindow.Bottom - csbi.srWindow.Top + 1;
                // Reserve space for prompt + scroll indicators + buffer
                let usable_height = if height > 6 { height - 4 } else { 20 };
                return TerminalSize {
                    height: usize::try_from(usable_height).unwrap(),
                    width: usize::try_from(width).unwrap(),
                };
            }
        }
        TerminalSize { height: 20, width: 80 } // Default fallback
    }

    fn truncate_with_ellipsis(text: &[u8], max_width: usize, only_end: bool) -> Box<[u8]> {
        if text.len() <= max_width {
            return Box::from(text);
        }

        if max_width <= 3 {
            return Box::from("…".as_bytes());
        }

        // Put ellipsis in the middle to show both start and end of package name
        let ellipsis = "…".as_bytes();
        let available_chars = max_width - 1; // Reserve 1 char for ellipsis
        let start_chars = if only_end { available_chars } else { available_chars / 2 };
        let end_chars = available_chars - start_chars;

        let mut result = vec![0u8; start_chars + ellipsis.len() + end_chars];
        result[0..start_chars].copy_from_slice(&text[0..start_chars]);
        result[start_chars..start_chars + ellipsis.len()].copy_from_slice(ellipsis);
        result[start_chars + ellipsis.len()..].copy_from_slice(&text[text.len() - end_chars..]);

        result.into_boxed_slice()
    }

    fn prompt_for_updates<'a>(
        packages: &'a mut [OutdatedPackage<'a>],
    ) -> Result<Box<[bool]>, bun_core::Error> {
        if packages.is_empty() {
            Output::prettyln(format_args!("<r><green>✓<r> All packages are up to date!"));
            return Ok(Box::default());
        }

        let mut selected = vec![false; packages.len()].into_boxed_slice();
        // Default to all unselected (already false from vec!)

        // Calculate optimal column widths based on terminal width and content
        let columns = Self::calculate_column_widths(packages);

        // Get terminal size for viewport and width optimization
        let terminal_size = Self::get_terminal_size();

        let mut state = MultiSelectState {
            packages,
            selected: &mut selected,
            cursor: 0,
            viewport_start: 0,
            viewport_height: terminal_size.height,
            toggle_all: false,
            max_name_len: columns.name,
            max_current_len: columns.current,
            max_update_len: columns.target,
            max_latest_len: columns.latest,
            max_workspace_len: columns.workspace,
            show_workspace: columns.show_workspace, // Show workspace if packages have workspaces
        };

        // Set raw mode
        #[cfg(windows)]
        let original_mode: Option<bun_sys::windows::DWORD> = bun_sys::windows::update_stdio_mode_flags(
            bun_sys::windows::StdioHandle::StdIn,
            bun_sys::windows::ModeFlags {
                set: bun_sys::windows::ENABLE_VIRTUAL_TERMINAL_INPUT
                    | bun_sys::windows::ENABLE_PROCESSED_INPUT,
                unset: bun_sys::windows::ENABLE_LINE_INPUT | bun_sys::windows::ENABLE_ECHO_INPUT,
            },
        )
        .ok();

        #[cfg(unix)]
        let _ = bun_core::tty::set_mode(0, bun_core::tty::Mode::Raw);

        let _restore = scopeguard::guard((), |_| {
            #[cfg(windows)]
            {
                if let Some(mode) = original_mode {
                    // SAFETY: stdin handle is valid for the process lifetime.
                    let _ = unsafe {
                        bun_sys::c::SetConsoleMode(bun_sys::Fd::stdin().native(), mode)
                    };
                }
            }
            #[cfg(unix)]
            {
                let _ = bun_core::tty::set_mode(0, bun_core::tty::Mode::Normal);
            }
        });

        let result = match Self::process_multi_select(&mut state, terminal_size) {
            Ok(r) => r,
            Err(err) => {
                if err == bun_core::err!("EndOfStream") {
                    Output::flush();
                    Output::prettyln(format_args!("\n<r><red>x<r> Cancelled"));
                    Global::exit(0);
                }
                return Err(err);
            }
        };

        Output::flush();
        // PORT NOTE: reshaped for borrowck — Zig returns the same `selected` slice via state;
        // we clone the borrowed slice into an owned Box here.
        Ok(Box::from(result))
    }

    fn ensure_cursor_in_viewport(state: &mut MultiSelectState<'_>) {
        // If cursor is not in viewport, position it sensibly
        if state.cursor < state.viewport_start {
            // Cursor is above viewport - put it at the start of viewport
            state.cursor = state.viewport_start;
        } else if state.cursor >= state.viewport_start + state.viewport_height {
            // Cursor is below viewport - put it at the end of viewport
            if !state.packages.is_empty() {
                let max_cursor = if state.packages.len() > 1 {
                    state.packages.len() - 1
                } else {
                    0
                };
                let viewport_end = state.viewport_start + state.viewport_height;
                state.cursor = (viewport_end - 1).min(max_cursor);
            }
        }
    }

    fn update_viewport(state: &mut MultiSelectState<'_>) {
        // Ensure cursor is visible with context (2 packages below, 2 above if possible)
        let context_below: usize = 2;
        let context_above: usize = 1;

        // If cursor is below viewport
        if state.cursor >= state.viewport_start + state.viewport_height {
            // Scroll down to show cursor with context
            let desired_start = if state.cursor + context_below + 1 > state.packages.len() {
                // Can't show full context, align bottom
                if state.packages.len() > state.viewport_height {
                    state.packages.len() - state.viewport_height
                } else {
                    0
                }
            } else {
                // Show cursor with context below
                if state.viewport_height > context_below
                    && state.cursor > state.viewport_height - context_below
                {
                    state.cursor - (state.viewport_height - context_below)
                } else {
                    0
                }
            };

            state.viewport_start = desired_start;
        }
        // If cursor is above viewport
        else if state.cursor < state.viewport_start {
            // Scroll up to show cursor with context above
            if state.cursor >= context_above {
                state.viewport_start = state.cursor - context_above;
            } else {
                state.viewport_start = 0;
            }
        }
        // If cursor is near bottom of viewport, adjust to maintain context
        else if state.viewport_height > context_below
            && state.cursor > state.viewport_start + state.viewport_height - context_below
        {
            let max_start = if state.packages.len() > state.viewport_height {
                state.packages.len() - state.viewport_height
            } else {
                0
            };
            let desired_start = if state.viewport_height > context_below {
                state.cursor - (state.viewport_height - context_below)
            } else {
                state.cursor
            };
            state.viewport_start = desired_start.min(max_start);
        }
        // If cursor is near top of viewport, adjust to maintain context
        else if state.cursor < state.viewport_start + context_above && state.viewport_start > 0 {
            if state.cursor >= context_above {
                state.viewport_start = state.cursor - context_above;
            } else {
                state.viewport_start = 0;
            }
        }
    }

    fn process_multi_select<'a, 'b>(
        state: &'b mut MultiSelectState<'a>,
        initial_terminal_size: TerminalSize,
    ) -> Result<&'b [bool], bun_core::Error> {
        let colors = Output::enable_ansi_colors_stdout();

        // Clear any previous progress output
        Output::print(format_args!("\r\x1B[2K")); // Clear entire line
        Output::print(format_args!("\x1B[1A\x1B[2K")); // Move up one line and clear it too
        Output::flush();

        // Enable mouse tracking for scrolling (if terminal supports it)
        if colors {
            Output::print(format_args!("\x1b[?25l")); // hide cursor
            Output::print(format_args!("\x1b[?1000h")); // Enable basic mouse tracking
            Output::print(format_args!("\x1b[?1006h")); // Enable SGR extended mouse mode
        }
        let _restore_mouse = scopeguard::guard((), move |_| {
            if colors {
                Output::print(format_args!("\x1b[?25h")); // show cursor
                Output::print(format_args!("\x1b[?1000l")); // Disable mouse tracking
                Output::print(format_args!("\x1b[?1006l")); // Disable SGR extended mouse mode
            }
        });

        let mut initial_draw = true;
        let mut reprint_menu = true;
        let mut total_lines: usize = 0;
        let mut last_terminal_width = initial_terminal_size.width;
        // TODO(port): errdefer reprint_menu = false; — handled inline below by setting before early return on error.
        // TODO(port): defer block that uses state.selected — moved to explicit calls before each return.

        macro_rules! cleanup_and_reprint {
            ($reprint:expr) => {{
                if !initial_draw {
                    Output::up(total_lines);
                }
                Output::clear_to_end();
                if $reprint {
                    let mut count: usize = 0;
                    for &sel in state.selected.iter() {
                        if sel {
                            count += 1;
                        }
                    }
                    Output::prettyln(format_args!(
                        "<r><green>✓<r> Selected {} package{} to update",
                        count,
                        if count == 1 { "" } else { "s" }
                    ));
                }
            }};
        }

        loop {
            // Check for terminal resize
            let current_size = Self::get_terminal_size();
            if current_size.width != last_terminal_width {
                // Terminal was resized, update viewport and redraw
                state.viewport_height = current_size.height;
                let columns = Self::calculate_column_widths(state.packages);
                state.show_workspace = columns.show_workspace && current_size.width > 100;
                state.max_name_len = columns.name;
                state.max_current_len = columns.current;
                state.max_update_len = columns.target;
                state.max_latest_len = columns.latest;
                state.max_workspace_len = columns.workspace;
                last_terminal_width = current_size.width;
                Self::update_viewport(state);
                // Force full redraw
                initial_draw = true;
            }

            // The render body
            {
                let synchronized = Output::synchronized();
                let _sync_end = scopeguard::guard(synchronized, |s| s.end());

                if !initial_draw {
                    Output::up(total_lines);
                    Output::print(format_args!("\x1B[1G"));
                    Output::clear_to_end();
                }
                initial_draw = false;

                let help_text: &[u8] = b"Space to toggle, Enter to confirm, a to select all, n to select none, i to invert, l to toggle latest";
                let elipsised_help_text = Self::truncate_with_ellipsis(
                    help_text,
                    current_size.width - b"? Select packages to update - ".len(),
                    true,
                );
                Output::prettyln(format_args!(
                    "<r><cyan>?<r> Select packages to update<d> - {}<r>",
                    BStr::new(&elipsised_help_text)
                ));

                // Calculate how many lines the prompt will actually take due to terminal wrapping
                total_lines = 1;

                // Calculate available space for packages (reserve space for scroll indicators if needed)
                let needs_scrolling = state.packages.len() > state.viewport_height;
                let show_top_indicator = needs_scrolling && state.viewport_start > 0;

                // First calculate preliminary viewport end to determine if we need bottom indicator
                let preliminary_viewport_end =
                    (state.viewport_start + state.viewport_height).min(state.packages.len());
                let show_bottom_indicator =
                    needs_scrolling && preliminary_viewport_end < state.packages.len();

                // const is_bottom_scroll = needs_scrolling and state.viewport_start + state.viewport_height <= state.packages.len;

                // Show top scroll indicator if needed
                if show_top_indicator {
                    Output::pretty(format_args!(
                        "  <d>↑ {} more package{} above<r>",
                        state.viewport_start,
                        if state.viewport_start == 1 { "" } else { "s" }
                    ));
                }

                // Calculate how many packages we can actually display
                // The simple approach: just try to show viewport_height packages
                // The display loop will stop when it runs out of room
                let viewport_end =
                    (state.viewport_start + state.viewport_height).min(state.packages.len());

                // Group by dependency type
                let mut current_dep_type: Option<&'static [u8]> = None;

                // Track how many lines we've actually displayed (headers take 2 lines)
                let mut lines_displayed: usize = 0;
                let mut packages_displayed: usize = 0;

                // Only display packages within viewport
                for i in state.viewport_start..viewport_end {
                    let pkg = &state.packages[i];
                    let selected = state.selected[i];

                    // Check if we need a header and if we have room for it
                    let needs_header = current_dep_type.is_none()
                        || !strings::eql(current_dep_type.unwrap(), pkg.dependency_type);

                    // Print dependency type header with column headers if changed
                    if needs_header {
                        // Count selected packages in this dependency type
                        let mut selected_count: usize = 0;
                        debug_assert_eq!(state.packages.len(), state.selected.len());
                        for (p, &sel) in state.packages.iter().zip(state.selected.iter()) {
                            if strings::eql(p.dependency_type, pkg.dependency_type) && sel {
                                selected_count += 1;
                            }
                        }

                        // Print dependency type - bold if any selected
                        Output::print(format_args!("\n  "));
                        if selected_count > 0 {
                            Output::pretty(format_args!(
                                "<r><b>{} {}<r>",
                                BStr::new(pkg.dependency_type),
                                selected_count
                            ));
                        } else {
                            Output::pretty(format_args!("<r>{}<r>", BStr::new(pkg.dependency_type)));
                        }

                        // Calculate padding to align column headers with values
                        let mut j: usize = 0;
                        // Calculate actual displayed text length including count if present
                        let dep_type_text_len: usize = if selected_count > 0 {
                            // TODO(port): std.fmt.count("{d}") — count decimal digits
                            pkg.dependency_type.len() + 1 + (bun_core::fmt::fast_digit_count(selected_count as u64) as usize) // +1 for space
                        } else {
                            pkg.dependency_type.len()
                        };

                        // The padding should align with the first character of package names
                        // Package names start at: "    " (4 spaces) + "□ " (2 chars) = 6 chars from left
                        // Headers start at: "  " (2 spaces) + dep_type_text
                        // We need the headers to align where the current version column starts
                        // That's at: 6 (start of names) + max_name_len + 2 (spacing after names) - 2 (header indent) - dep_type_text_len
                        let total_offset = 6 + state.max_name_len + 2;
                        let header_start = 2 + dep_type_text_len;
                        let padding_to_current = if header_start >= total_offset {
                            1
                        } else {
                            total_offset - header_start
                        };
                        while j < padding_to_current {
                            Output::print(format_args!(" "));
                            j += 1;
                        }

                        // Column headers aligned with their columns
                        Output::print(format_args!("Current"));
                        j = 0;
                        while j < state.max_current_len - b"Current".len() + 2 {
                            Output::print(format_args!(" "));
                            j += 1;
                        }
                        Output::print(format_args!("Target"));
                        j = 0;
                        while j < state.max_update_len - b"Target".len() + 2 {
                            Output::print(format_args!(" "));
                            j += 1;
                        }
                        Output::print(format_args!("Latest"));
                        if state.show_workspace {
                            j = 0;
                            while j < state.max_latest_len - b"Latest".len() + 2 {
                                Output::print(format_args!(" "));
                                j += 1;
                            }
                            Output::print(format_args!("Workspace"));
                        }
                        Output::print(format_args!("\x1B[0K\n"));

                        lines_displayed += 2;
                        current_dep_type = Some(pkg.dependency_type);
                    }

                    let is_cursor = i == state.cursor;
                    let checkbox: &str = if selected { "■" } else { "□" };

                    // Calculate padding - account for dev/peer/optional tags
                    let mut dev_tag_len: usize = 0;
                    if pkg.behavior.dev {
                        dev_tag_len = 4; // " dev"
                    } else if pkg.behavior.peer {
                        dev_tag_len = 5; // " peer"
                    } else if pkg.behavior.optional {
                        dev_tag_len = 9; // " optional"
                    }
                    let total_name_len = pkg.name.len() + dev_tag_len;
                    let name_padding = if total_name_len >= state.max_name_len {
                        0
                    } else {
                        state.max_name_len - total_name_len
                    };

                    // Determine version change severity for checkbox color
                    let current_ver_parsed = semver::Version::parse(SlicedString::init(
                        &pkg.current_version,
                        &pkg.current_version,
                    ));
                    let update_ver_parsed = if pkg.use_latest {
                        semver::Version::parse(SlicedString::init(
                            &pkg.latest_version,
                            &pkg.latest_version,
                        ))
                    } else {
                        semver::Version::parse(SlicedString::init(
                            &pkg.update_version,
                            &pkg.update_version,
                        ))
                    };

                    let mut checkbox_color: &str = "green"; // default
                    if current_ver_parsed.valid && update_ver_parsed.valid {
                        let current_full = semver::Version {
                            major: current_ver_parsed.version.major.unwrap_or(0),
                            minor: current_ver_parsed.version.minor.unwrap_or(0),
                            patch: current_ver_parsed.version.patch.unwrap_or(0),
                            tag: current_ver_parsed.version.tag,
                        };
                        let update_full = semver::Version {
                            major: update_ver_parsed.version.major.unwrap_or(0),
                            minor: update_ver_parsed.version.minor.unwrap_or(0),
                            patch: update_ver_parsed.version.patch.unwrap_or(0),
                            tag: update_ver_parsed.version.tag,
                        };

                        let target_ver_str: &[u8] = if pkg.use_latest {
                            &pkg.latest_version
                        } else {
                            &pkg.update_version
                        };
                        let diff = update_full.which_version_is_different(
                            &current_full,
                            target_ver_str,
                            &pkg.current_version,
                        );
                        if let Some(d) = diff {
                            match d {
                                semver::version::ChangedVersion::Major => checkbox_color = "red",
                                semver::version::ChangedVersion::Minor => {
                                    if current_full.major == 0 {
                                        checkbox_color = "red"; // 0.x.y minor changes are breaking
                                    } else {
                                        checkbox_color = "yellow";
                                    }
                                }
                                semver::version::ChangedVersion::Patch => {
                                    if current_full.major == 0 && current_full.minor == 0 {
                                        checkbox_color = "red"; // 0.0.x patch changes are breaking
                                    } else {
                                        checkbox_color = "green";
                                    }
                                }
                                _ => checkbox_color = "green",
                            }
                        }
                    }

                    // Cursor and checkbox
                    if is_cursor {
                        Output::pretty(format_args!("  <r><cyan>❯<r> "));
                    } else {
                        Output::print(format_args!("    "));
                    }

                    // Checkbox with appropriate color
                    if selected {
                        if checkbox_color == "red" {
                            Output::pretty(format_args!("<r><red>{}<r> ", checkbox));
                        } else if checkbox_color == "yellow" {
                            Output::pretty(format_args!("<r><yellow>{}<r> ", checkbox));
                        } else {
                            Output::pretty(format_args!("<r><green>{}<r> ", checkbox));
                        }
                    } else {
                        Output::print(format_args!("{} ", checkbox));
                    }

                    // Package name - truncate if needed and make it a hyperlink if colors are enabled and using default registry
                    // Calculate available space for name (accounting for dev/peer/optional tags)
                    let available_name_width = if state.max_name_len > dev_tag_len {
                        state.max_name_len - dev_tag_len
                    } else {
                        state.max_name_len
                    };
                    let display_name =
                        Self::truncate_with_ellipsis(&pkg.name, available_name_width, false);

                    let uses_default_registry = pkg.manager.options.scope.url_hash
                        == bun_install::npm::Registry::DEFAULT_URL_HASH
                        && pkg.manager.scope_for_package_name(&pkg.name).url_hash
                            == bun_install::npm::Registry::DEFAULT_URL_HASH;
                    let package_url: Box<[u8]> = if Output::enable_ansi_colors_stdout()
                        && uses_default_registry
                    {
                        let ver: &[u8] = 'brk: {
                            if selected {
                                if pkg.use_latest {
                                    break 'brk &pkg.latest_version;
                                } else {
                                    break 'brk &pkg.update_version;
                                }
                            } else {
                                break 'brk &pkg.current_version;
                            }
                        };
                        let mut v = Vec::new();
                        write!(
                            &mut v,
                            "https://npmjs.org/package/{}/v/{}",
                            BStr::new(&pkg.name),
                            BStr::new(ver)
                        )
                        .unwrap();
                        v.into_boxed_slice()
                    } else {
                        Box::default()
                    };

                    let hyperlink =
                        TerminalHyperlink::new(&package_url, &display_name, !package_url.is_empty());

                    if selected {
                        if checkbox_color == "red" {
                            Output::pretty(format_args!("<r><red>{}<r>", hyperlink));
                        } else if checkbox_color == "yellow" {
                            Output::pretty(format_args!("<r><yellow>{}<r>", hyperlink));
                        } else {
                            Output::pretty(format_args!("<r><green>{}<r>", hyperlink));
                        }
                    } else {
                        Output::pretty(format_args!("<r>{}<r>", hyperlink));
                    }

                    // Print dev/peer/optional tag if applicable
                    if pkg.behavior.dev {
                        Output::pretty(format_args!("<r><d> dev<r>"));
                    } else if pkg.behavior.peer {
                        Output::pretty(format_args!("<r><d> peer<r>"));
                    } else if pkg.behavior.optional {
                        Output::pretty(format_args!("<r><d> optional<r>"));
                    }

                    // Print padding after name (2 spaces)
                    let mut j: usize = 0;
                    while j < name_padding + 2 {
                        Output::print(format_args!(" "));
                        j += 1;
                    }

                    // Current version - truncate if needed
                    let truncated_current = Self::truncate_with_ellipsis(
                        &pkg.current_version,
                        state.max_current_len,
                        false,
                    );
                    Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_current)));

                    // Print padding after current version (2 spaces)
                    let current_padding = if truncated_current.len() >= state.max_current_len {
                        0
                    } else {
                        state.max_current_len - truncated_current.len()
                    };
                    j = 0;
                    while j < current_padding + 2 {
                        Output::print(format_args!(" "));
                        j += 1;
                    }

                    // Target version with diffFmt coloring - bold if not using latest
                    let target_ver_parsed = semver::Version::parse(SlicedString::init(
                        &pkg.update_version,
                        &pkg.update_version,
                    ));

                    // Truncate target version if needed
                    let truncated_target = Self::truncate_with_ellipsis(
                        &pkg.update_version,
                        state.max_update_len,
                        false,
                    );

                    // For width calculation, use the truncated version string length
                    let target_width: usize = truncated_target.len();

                    if current_ver_parsed.valid && target_ver_parsed.valid {
                        let current_full = semver::Version {
                            major: current_ver_parsed.version.major.unwrap_or(0),
                            minor: current_ver_parsed.version.minor.unwrap_or(0),
                            patch: current_ver_parsed.version.patch.unwrap_or(0),
                            tag: current_ver_parsed.version.tag,
                        };
                        let target_full = semver::Version {
                            major: target_ver_parsed.version.major.unwrap_or(0),
                            minor: target_ver_parsed.version.minor.unwrap_or(0),
                            patch: target_ver_parsed.version.patch.unwrap_or(0),
                            tag: target_ver_parsed.version.tag,
                        };

                        // Print target version (use truncated version for narrow terminals)
                        if selected && !pkg.use_latest {
                            Output::print(format_args!("\x1B[4m")); // Start underline
                        }
                        if truncated_target.len() < pkg.update_version.len() {
                            // If truncated, use plain display instead of diffFmt to avoid confusion
                            Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_target)));
                        } else {
                            // Use diffFmt for full versions
                            Output::pretty(format_args!(
                                "{}",
                                target_full.diff_fmt(
                                    &current_full,
                                    &pkg.update_version,
                                    &pkg.current_version,
                                )
                            ));
                        }
                        if selected && !pkg.use_latest {
                            Output::print(format_args!("\x1B[24m")); // End underline
                        }
                    } else {
                        // Fallback if version parsing fails
                        if selected && !pkg.use_latest {
                            Output::print(format_args!("\x1B[4m")); // Start underline
                        }
                        Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_target)));
                        if selected && !pkg.use_latest {
                            Output::print(format_args!("\x1B[24m")); // End underline
                        }
                    }

                    let target_padding = if target_width >= state.max_update_len {
                        0
                    } else {
                        state.max_update_len - target_width
                    };
                    j = 0;
                    while j < target_padding + 2 {
                        Output::print(format_args!(" "));
                        j += 1;
                    }

                    // Latest version with diffFmt coloring - bold if using latest
                    let latest_ver_parsed = semver::Version::parse(SlicedString::init(
                        &pkg.latest_version,
                        &pkg.latest_version,
                    ));

                    // Truncate latest version if needed
                    let truncated_latest = Self::truncate_with_ellipsis(
                        &pkg.latest_version,
                        state.max_latest_len,
                        false,
                    );
                    if current_ver_parsed.valid && latest_ver_parsed.valid {
                        let current_full = semver::Version {
                            major: current_ver_parsed.version.major.unwrap_or(0),
                            minor: current_ver_parsed.version.minor.unwrap_or(0),
                            patch: current_ver_parsed.version.patch.unwrap_or(0),
                            tag: current_ver_parsed.version.tag,
                        };
                        let latest_full = semver::Version {
                            major: latest_ver_parsed.version.major.unwrap_or(0),
                            minor: latest_ver_parsed.version.minor.unwrap_or(0),
                            patch: latest_ver_parsed.version.patch.unwrap_or(0),
                            tag: latest_ver_parsed.version.tag,
                        };

                        // Dim if latest matches target version
                        let is_same_as_target =
                            strings::eql(&pkg.latest_version, &pkg.update_version);
                        if is_same_as_target {
                            Output::print(format_args!("\x1B[2m")); // Dim
                        }
                        // Print latest version
                        if selected && pkg.use_latest {
                            Output::print(format_args!("\x1B[4m")); // Start underline
                        }
                        if truncated_latest.len() < pkg.latest_version.len() {
                            // If truncated, use plain display instead of diffFmt to avoid confusion
                            Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_latest)));
                        } else {
                            // Use diffFmt for full versions
                            Output::pretty(format_args!(
                                "{}",
                                latest_full.diff_fmt(
                                    &current_full,
                                    &pkg.latest_version,
                                    &pkg.current_version,
                                )
                            ));
                        }
                        if selected && pkg.use_latest {
                            Output::print(format_args!("\x1B[24m")); // End underline
                        }
                        if is_same_as_target {
                            Output::print(format_args!("\x1B[22m")); // Reset dim
                        }
                    } else {
                        // Fallback if version parsing fails
                        let is_same_as_target =
                            strings::eql(&pkg.latest_version, &pkg.update_version);
                        if is_same_as_target {
                            Output::print(format_args!("\x1B[2m")); // Dim
                        }
                        if selected && pkg.use_latest {
                            Output::print(format_args!("\x1B[4m")); // Start underline
                        }
                        Output::pretty(format_args!("<r>{}<r>", BStr::new(&truncated_latest)));
                        if selected && pkg.use_latest {
                            Output::print(format_args!("\x1B[24m")); // End underline
                        }
                        if is_same_as_target {
                            Output::print(format_args!("\x1B[22m")); // Reset dim
                        }
                    }

                    // Workspace column
                    if state.show_workspace {
                        let latest_width: usize = truncated_latest.len();
                        let latest_padding = if latest_width >= state.max_latest_len {
                            0
                        } else {
                            state.max_latest_len - latest_width
                        };
                        j = 0;
                        while j < latest_padding + 2 {
                            Output::print(format_args!(" "));
                            j += 1;
                        }
                        // Truncate workspace name if needed
                        let truncated_workspace = Self::truncate_with_ellipsis(
                            &pkg.workspace_name,
                            state.max_workspace_len,
                            true,
                        );
                        Output::pretty(format_args!(
                            "<r><d>{}<r>",
                            BStr::new(&truncated_workspace)
                        ));
                    }

                    Output::print(format_args!("\x1B[0K\n"));
                    lines_displayed += 1;
                    packages_displayed += 1;
                }

                let _ = packages_displayed;

                // Show bottom scroll indicator if needed
                if show_bottom_indicator {
                    Output::pretty(format_args!(
                        "  <d>↓ {} more package{} below<r>",
                        state.packages.len() - viewport_end,
                        if state.packages.len() - viewport_end == 1 { "" } else { "s" }
                    ));
                    lines_displayed += 1;
                }

                total_lines = lines_displayed + 1;
                Output::clear_to_end();
            }
            Output::flush();

            // Read input
            // TODO(port): std.fs.File.stdin().readerStreaming — use bun_sys stdin byte reader
            let mut reader = bun_core::output::stdin_reader();
            let byte = match reader.take_byte() {
                Ok(b) => b,
                Err(_) => {
                    cleanup_and_reprint!(reprint_menu);
                    return Ok(state.selected);
                }
            };

            match byte {
                b'\n' | b'\r' => {
                    cleanup_and_reprint!(reprint_menu);
                    return Ok(state.selected);
                }
                3 | 4 => {
                    // ctrl+c, ctrl+d
                    reprint_menu = false;
                    cleanup_and_reprint!(reprint_menu);
                    return Err(bun_core::err!("EndOfStream"));
                }
                b' ' => {
                    state.selected[state.cursor] = !state.selected[state.cursor];
                    // if the package only has a latest version, then we should toggle the latest version instead of update
                    if strings::eql(
                        &state.packages[state.cursor].current_version,
                        &state.packages[state.cursor].update_version,
                    ) {
                        state.packages[state.cursor].use_latest = true;
                    }
                    state.toggle_all = false;
                    // Don't move cursor on space - let user manually navigate
                }
                b'a' | b'A' => {
                    state.selected.fill(true);
                    // For packages where current == update version, auto-set use_latest
                    // so they get updated to the latest version (matching spacebar behavior)
                    for pkg in state.packages.iter_mut() {
                        if strings::eql(&pkg.current_version, &pkg.update_version) {
                            pkg.use_latest = true;
                        }
                    }
                    state.toggle_all = true; // Mark that 'a' was used
                }
                b'n' | b'N' => {
                    state.selected.fill(false);
                    state.toggle_all = false; // Reset toggle_all mode
                }
                b'i' | b'I' => {
                    // Invert selection
                    for sel in state.selected.iter_mut() {
                        *sel = !*sel;
                    }
                    state.toggle_all = false; // Reset toggle_all mode
                }
                b'l' | b'L' => {
                    // Only affect all packages if 'a' (select all) was used
                    // Otherwise, just toggle the current cursor package
                    if state.toggle_all {
                        // All packages were selected with 'a', so toggle latest for all selected packages
                        let new_latest_state = !state.packages[state.cursor].use_latest;
                        debug_assert_eq!(state.selected.len(), state.packages.len());
                        for (sel, pkg) in state.selected.iter().zip(state.packages.iter_mut()) {
                            if *sel {
                                pkg.use_latest = new_latest_state;
                            }
                        }
                    } else {
                        // Individual selection mode, just toggle current cursor package and select it
                        state.packages[state.cursor].use_latest =
                            !state.packages[state.cursor].use_latest;
                        state.selected[state.cursor] = true;
                    }
                }
                b'j' => {
                    if state.cursor < state.packages.len() - 1 {
                        state.cursor += 1;
                    } else {
                        state.cursor = 0;
                    }
                    Self::update_viewport(state);
                    state.toggle_all = false;
                }
                b'k' => {
                    if state.cursor > 0 {
                        state.cursor -= 1;
                    } else {
                        state.cursor = state.packages.len() - 1;
                    }
                    Self::update_viewport(state);
                    state.toggle_all = false;
                }
                27 => {
                    // escape sequence
                    let Ok(seq) = reader.take_byte() else { continue };
                    if seq == b'[' {
                        let Ok(arrow) = reader.take_byte() else { continue };
                        match arrow {
                            b'A' => {
                                // up arrow
                                if state.cursor > 0 {
                                    state.cursor -= 1;
                                } else {
                                    state.cursor = state.packages.len() - 1;
                                }
                                Self::update_viewport(state);
                            }
                            b'B' => {
                                // down arrow
                                if state.cursor < state.packages.len() - 1 {
                                    state.cursor += 1;
                                } else {
                                    state.cursor = 0;
                                }
                                Self::update_viewport(state);
                            }
                            b'C' => {
                                // right arrow - switch to Latest version and select
                                state.packages[state.cursor].use_latest = true;
                                state.selected[state.cursor] = true;
                            }
                            b'D' => {
                                // left arrow - switch to Target version and select
                                state.packages[state.cursor].use_latest = false;
                                state.selected[state.cursor] = true;
                            }
                            b'5' => {
                                // Page Up
                                let Ok(tilde) = reader.take_byte() else { continue };
                                if tilde == b'~' {
                                    // Move up by viewport height
                                    if state.cursor >= state.viewport_height {
                                        state.cursor -= state.viewport_height;
                                    } else {
                                        state.cursor = 0;
                                    }
                                    Self::update_viewport(state);
                                }
                            }
                            b'6' => {
                                // Page Down
                                let Ok(tilde) = reader.take_byte() else { continue };
                                if tilde == b'~' {
                                    // Move down by viewport height
                                    if state.cursor + state.viewport_height < state.packages.len() {
                                        state.cursor += state.viewport_height;
                                    } else {
                                        state.cursor = state.packages.len() - 1;
                                    }
                                    Self::update_viewport(state);
                                }
                            }
                            b'<' => {
                                // SGR extended mouse mode
                                // Read until 'M' or 'm' for button press/release
                                let mut buffer = [0u8; 32];
                                let mut buf_idx: usize = 0;
                                while buf_idx < buffer.len() {
                                    let Ok(c) = reader.take_byte() else { break };
                                    if c == b'M' || c == b'm' {
                                        // Parse SGR mouse event: ESC[<button;col;row(M or m)
                                        // button: 64 = scroll up, 65 = scroll down
                                        let mut parts = buffer[0..buf_idx]
                                            .split(|b| *b == b';')
                                            .filter(|s| !s.is_empty());
                                        if let Some(button_str) = parts.next() {
                                            // TODO(port): replace inline fold with shared bun_str parse_int helper
                                            // std.fmt.parseInt(u32, _, 10) on raw bytes — terminal
                                            // input is bytes, do not round-trip through from_utf8.
                                            let button: u32 = button_str
                                                .iter()
                                                .try_fold(0u32, |acc, &b| match b {
                                                    b'0'..=b'9' => acc
                                                        .checked_mul(10)
                                                        .and_then(|a| a.checked_add((b - b'0') as u32)),
                                                    _ => None,
                                                })
                                                .unwrap_or(0);
                                            // Mouse wheel events
                                            if button == 64 {
                                                // Scroll up
                                                if state.viewport_start > 0 {
                                                    // Scroll up by 3 lines
                                                    let scroll_amount =
                                                        1usize.min(state.viewport_start);
                                                    state.viewport_start -= scroll_amount;
                                                    Self::ensure_cursor_in_viewport(state);
                                                }
                                            } else if button == 65 {
                                                // Scroll down
                                                if state.viewport_start + state.viewport_height
                                                    < state.packages.len()
                                                {
                                                    // Scroll down by 3 lines
                                                    let max_scroll = state.packages.len()
                                                        - (state.viewport_start
                                                            + state.viewport_height);
                                                    let scroll_amount = 1usize.min(max_scroll);
                                                    state.viewport_start += scroll_amount;
                                                    Self::ensure_cursor_in_viewport(state);
                                                }
                                            }
                                        }
                                        break;
                                    }
                                    buffer[buf_idx] = c;
                                    buf_idx += 1;
                                }
                            }
                            _ => {}
                        }
                    }
                    state.toggle_all = false;
                }
                _ => {
                    state.toggle_all = false;
                }
            }
        }
    }
}

/// Edit catalog definitions in package.json
pub fn edit_catalog_definitions(
    manager: &mut PackageManager,
    updates: &mut [CatalogUpdateRequest],
    current_package_json: &mut Expr,
) -> Result<(), bun_core::Error> {
    // using data store is going to result in undefined memory issues as
    // the store is cleared in some workspace situations. the solution
    // is to always avoid the store
    Expr::Disabler::disable();
    let _reenable = scopeguard::guard((), |_| Expr::Disabler::enable());

    let _ = manager; // allocator removed in Rust port

    for update in updates.iter() {
        if let Some(catalog_name) = &update.catalog_name {
            update_named_catalog(
                current_package_json,
                catalog_name,
                &update.package_name,
                &update.new_version,
            )?;
        } else {
            update_default_catalog(
                current_package_json,
                &update.package_name,
                &update.new_version,
            )?;
        }
    }
    Ok(())
}

fn update_default_catalog(
    package_json: &mut Expr,
    package_name: &[u8],
    new_version: &[u8],
) -> Result<(), bun_core::Error> {
    // Get or create the catalog object
    // First check if catalog is under workspaces.catalog
    let mut catalog_obj = 'brk: {
        if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
            if let bun_js_parser::ast::ExprData::EObject(_) = &workspaces_query.expr.data {
                if let Some(catalog_query) = workspaces_query.expr.as_property(b"catalog") {
                    if let bun_js_parser::ast::ExprData::EObject(obj) = &catalog_query.expr.data {
                        break 'brk obj.clone();
                    }
                }
            }
        }
        // Fallback to root-level catalog
        if let Some(catalog_query) = package_json.as_property(b"catalog") {
            if let bun_js_parser::ast::ExprData::EObject(obj) = &catalog_query.expr.data {
                break 'brk obj.clone();
            }
        }
        E::Object::default()
    };

    // Get original version to preserve prefix if it exists
    let mut version_with_prefix: Box<[u8]> = Box::from(new_version);
    if let Some(existing_prop) = catalog_obj.get(package_name) {
        if let bun_js_parser::ast::ExprData::EString(e_string) = &existing_prop.data {
            let original_version = &e_string.data;
            version_with_prefix = preserve_version_prefix(original_version, new_version)?;
        }
    }

    // Update or add the package version
    let new_expr = Expr::allocate(E::String { data: version_with_prefix }, logger::Loc::EMPTY);
    catalog_obj.put(package_name, new_expr)?;

    // Check if we need to update under workspaces.catalog or root-level catalog
    if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
        if let bun_js_parser::ast::ExprData::EObject(ws_obj) = &mut workspaces_query.expr.data {
            if workspaces_query.expr.as_property(b"catalog").is_some() {
                // Update under workspaces.catalog
                ws_obj.put(
                    b"catalog",
                    Expr::allocate(E::Object::from(catalog_obj), logger::Loc::EMPTY),
                )?;
                return Ok(());
            }
        }
    }

    // Otherwise update at root level
    if let bun_js_parser::ast::ExprData::EObject(root_obj) = &mut package_json.data {
        root_obj.put(
            b"catalog",
            Expr::allocate(E::Object::from(catalog_obj), logger::Loc::EMPTY),
        )?;
    }
    Ok(())
}

fn update_named_catalog(
    package_json: &mut Expr,
    catalog_name: &[u8],
    package_name: &[u8],
    new_version: &[u8],
) -> Result<(), bun_core::Error> {
    // Get or create the catalogs object
    // First check if catalogs is under workspaces.catalogs (newer structure)
    let mut catalogs_obj = 'brk: {
        if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
            if let bun_js_parser::ast::ExprData::EObject(_) = &workspaces_query.expr.data {
                if let Some(catalogs_query) = workspaces_query.expr.as_property(b"catalogs") {
                    if let bun_js_parser::ast::ExprData::EObject(obj) = &catalogs_query.expr.data {
                        break 'brk obj.clone();
                    }
                }
            }
        }
        // Fallback to root-level catalogs
        if let Some(catalogs_query) = package_json.as_property(b"catalogs") {
            if let bun_js_parser::ast::ExprData::EObject(obj) = &catalogs_query.expr.data {
                break 'brk obj.clone();
            }
        }
        E::Object::default()
    };

    // Get or create the specific catalog
    let mut catalog_obj = 'brk: {
        if let Some(catalog_query) = catalogs_obj.get(catalog_name) {
            if let bun_js_parser::ast::ExprData::EObject(obj) = &catalog_query.data {
                break 'brk obj.clone();
            }
        }
        E::Object::default()
    };

    // Get original version to preserve prefix if it exists
    let mut version_with_prefix: Box<[u8]> = Box::from(new_version);
    if let Some(existing_prop) = catalog_obj.get(package_name) {
        if let bun_js_parser::ast::ExprData::EString(e_string) = &existing_prop.data {
            let original_version = &e_string.data;
            version_with_prefix = preserve_version_prefix(original_version, new_version)?;
        }
    }

    // Update or add the package version
    let new_expr = Expr::allocate(E::String { data: version_with_prefix }, logger::Loc::EMPTY);
    catalog_obj.put(package_name, new_expr)?;

    // Update the catalog in catalogs object
    catalogs_obj.put(
        catalog_name,
        Expr::allocate(E::Object::from(catalog_obj), logger::Loc::EMPTY),
    )?;

    // Check if we need to update under workspaces.catalogs or root-level catalogs
    if let Some(workspaces_query) = package_json.as_property(b"workspaces") {
        if let bun_js_parser::ast::ExprData::EObject(ws_obj) = &mut workspaces_query.expr.data {
            if workspaces_query.expr.as_property(b"catalogs").is_some() {
                // Update under workspaces.catalogs
                ws_obj.put(
                    b"catalogs",
                    Expr::allocate(E::Object::from(catalogs_obj), logger::Loc::EMPTY),
                )?;
                return Ok(());
            }
        }
    }

    // Otherwise update at root level
    if let bun_js_parser::ast::ExprData::EObject(root_obj) = &mut package_json.data {
        root_obj.put(
            b"catalogs",
            Expr::allocate(E::Object::from(catalogs_obj), logger::Loc::EMPTY),
        )?;
    }
    Ok(())
}

fn preserve_version_prefix(
    original_version: &[u8],
    new_version: &[u8],
) -> Result<Box<[u8]>, bun_core::Error> {
    if original_version.len() > 1 {
        let mut orig_version: &[u8] = original_version;
        let mut alias: Option<&[u8]> = None;

        // Preserve npm: prefix
        if let Some(after_npm) = strings::without_prefix_if_possible_comptime(original_version, b"npm:") {
            if let Some(i) = strings::last_index_of_char(after_npm, b'@') {
                alias = Some(&after_npm[0..i]);
                if i + 2 < after_npm.len() {
                    orig_version = &after_npm[i + 1..];
                }
            } else {
                alias = Some(after_npm);
            }
        }

        // Preserve other version prefixes
        let first_char = orig_version[0];
        if first_char == b'^'
            || first_char == b'~'
            || first_char == b'>'
            || first_char == b'<'
            || first_char == b'='
        {
            let second_char = orig_version[1];
            if (first_char == b'>' || first_char == b'<') && second_char == b'=' {
                if let Some(a) = alias {
                    let mut v = Vec::new();
                    write!(
                        &mut v,
                        "npm:{}@{}={}",
                        BStr::new(a),
                        first_char as char,
                        BStr::new(new_version)
                    )
                    .unwrap();
                    return Ok(v.into_boxed_slice());
                }
                let mut v = Vec::new();
                write!(&mut v, "{}={}", first_char as char, BStr::new(new_version)).unwrap();
                return Ok(v.into_boxed_slice());
            }
            if let Some(a) = alias {
                let mut v = Vec::new();
                write!(
                    &mut v,
                    "npm:{}@{}{}",
                    BStr::new(a),
                    first_char as char,
                    BStr::new(new_version)
                )
                .unwrap();
                return Ok(v.into_boxed_slice());
            }
            let mut v = Vec::new();
            write!(&mut v, "{}{}", first_char as char, BStr::new(new_version)).unwrap();
            return Ok(v.into_boxed_slice());
        }
        if let Some(a) = alias {
            let mut v = Vec::new();
            write!(&mut v, "npm:{}@{}", BStr::new(a), BStr::new(new_version)).unwrap();
            return Ok(v.into_boxed_slice());
        }
    }
    Ok(Box::from(new_version))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/update_interactive_command.zig (2062 lines)
//   confidence: medium
//   todos:      8
//   notes:      Heavy bun_install/AST cross-crate types guessed; defer/errdefer in process_multi_select reshaped to inline macro; stdin reader + ioctl/winapi need bun_sys wrappers.
// ──────────────────────────────────────────────────────────────────────────
