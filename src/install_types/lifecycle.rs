use core::ptr::NonNull;

use bun_core::{time::Timer, ZBox};
use bun_io_types::reader::BufferedReaderHandle;
use bun_spawn_types::{ProcessExitContext, ProcessHandle, ProcessIdentity, Status};

use crate::{LifecycleScriptExit, LifecycleScriptExitAction};

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

#[derive(Clone, Copy)]
pub struct InstallerHandle {
    ptr: NonNull<()>,
}

impl InstallerHandle {
    #[inline]
    pub fn from_ptr<T>(ptr: *mut T) -> Option<Self> {
        NonNull::new(ptr.cast()).map(|ptr| Self { ptr })
    }

    #[inline]
    pub fn as_ptr<T>(self) -> *mut T {
        self.ptr.as_ptr().cast()
    }
}

pub struct InstallCtx {
    pub entry_id: u32,
    pub installer: InstallerHandle,
}

pub struct LifecycleScriptState {
    pub scripts: ScriptsList,
    pub package_name: Box<[u8]>,
    pub current_script_index: u8,
    pub pending_output_fds: i8,
    pub process_handle: Option<ProcessHandle>,
    pub stdout_reader: Option<BufferedReaderHandle>,
    pub stderr_reader: Option<BufferedReaderHandle>,
    pub exit_state: Option<LifecycleScriptExit>,
    pub foreground: bool,
    pub optional: bool,
    pub started_at: u64,
    pub timer: Option<Timer>,
    pub has_incremented_alive_count: bool,
    pub ctx: Option<InstallCtx>,
}

impl LifecycleScriptState {
    #[inline]
    pub fn new(
        scripts: ScriptsList,
        foreground: bool,
        optional: bool,
        ctx: Option<InstallCtx>,
    ) -> Self {
        let package_name = scripts.package_name.clone();
        Self {
            scripts,
            package_name,
            current_script_index: 0,
            pending_output_fds: 0,
            process_handle: None,
            stdout_reader: None,
            stderr_reader: None,
            exit_state: None,
            foreground,
            optional,
            started_at: 0,
            timer: None,
            has_incremented_alive_count: false,
            ctx,
        }
    }

    #[inline]
    pub fn script_name(&self) -> &'static [u8] {
        debug_assert!((self.current_script_index as usize) < SCRIPT_NAMES.len());
        ScriptsList::script_name(self.current_script_index as usize).as_bytes()
    }

    #[inline]
    pub fn reset_for_script(&mut self, script_index: u8) {
        self.current_script_index = script_index;
        self.pending_output_fds = 0;
        self.process_handle = None;
        self.stdout_reader = None;
        self.stderr_reader = None;
        self.exit_state = None;
    }

    #[inline]
    pub fn reset_exit_state(&mut self) {
        self.exit_state = None;
        self.pending_output_fds = 0;
        self.process_handle = None;
        self.stdout_reader = None;
        self.stderr_reader = None;
    }

    #[inline]
    pub fn mark_started_at(&mut self, started_at: u64) {
        self.pending_output_fds = 0;
        self.started_at = started_at;
    }

    #[inline]
    pub fn record_output_fd(&mut self) {
        self.pending_output_fds += 1;
    }

    #[inline]
    pub fn record_stdout_reader(&mut self, reader: BufferedReaderHandle) {
        self.stdout_reader = Some(reader);
    }

    #[inline]
    pub fn record_stderr_reader(&mut self, reader: BufferedReaderHandle) {
        self.stderr_reader = Some(reader);
    }

    #[inline]
    pub fn initialize_exit_state(&mut self, process: ProcessIdentity) {
        self.exit_state = Some(LifecycleScriptExit::new(
            process,
            self.pending_output_fds,
        ));
    }

    #[inline]
    pub fn initialize_exit_state_from_handle(&mut self, process: ProcessHandle) {
        self.process_handle = Some(process);
        self.initialize_exit_state(process.identity());
    }

    #[inline]
    pub fn matches_process_handle(&self, process: ProcessHandle) -> bool {
        self.process_handle == Some(process)
    }

    #[inline]
    pub fn record_reader_done(&mut self) -> LifecycleScriptExitAction {
        if let Some(exit_state) = self.exit_state.as_mut() {
            exit_state.record_reader_done()
        } else {
            debug_assert!(self.pending_output_fds > 0);
            self.pending_output_fds = self.pending_output_fds.saturating_sub(1);
            LifecycleScriptExitAction::Pending
        }
    }

    #[inline]
    pub fn on_process_exit(&mut self, ctx: &ProcessExitContext<'_>) -> LifecycleScriptExitAction {
        if self.exit_state.is_none() {
            self.initialize_exit_state(ctx.process_identity());
        }

        self.exit_state
            .as_mut()
            .expect("exit state initialized above")
            .on_process_exit(ctx)
    }

    #[inline]
    pub fn output_drained(&self) -> bool {
        self.exit_state
            .as_ref()
            .map(LifecycleScriptExit::output_drained)
            .unwrap_or(self.pending_output_fds == 0)
    }

    #[inline]
    pub fn exit_status(&self) -> Option<Status> {
        self.exit_state
            .as_ref()
            .and_then(|exit_state| exit_state.exit_status.clone())
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

    #[test]
    fn lifecycle_state_records_reader_before_process_exit() {
        let process = ProcessIdentity::from_usize(10).unwrap();
        let process_handle = ProcessHandle::from_usize(process.get()).unwrap();
        let rusage = bun_spawn_types::rusage_zeroed();
        let mut state = LifecycleScriptState::new(
            ScriptsList {
                items: [
                    Some(Box::<[u8]>::from(b"preinstall".as_slice())),
                    None,
                    None,
                    None,
                    None,
                    None,
                ],
                first_index: 0,
                total: 1,
                cwd: ZBox::from_bytes(b"/tmp/pkg"),
                package_name: Box::<[u8]>::from(b"pkg".as_slice()),
            },
            false,
            false,
            None,
        );

        state.record_output_fd();
        state.initialize_exit_state_from_handle(process_handle);
        assert!(state.matches_process_handle(process_handle));
        assert_eq!(state.record_reader_done(), LifecycleScriptExitAction::Pending);
        assert_eq!(
            state.on_process_exit(&ProcessExitContext::new(
                process,
                Status::Exited(bun_spawn_types::Exited { code: 0, signal: 0 }),
                &rusage,
            )),
            LifecycleScriptExitAction::MaybeFinished
        );
        assert_eq!(state.exit_status().and_then(|status| status.exit_code()), Some(0));
    }

    #[test]
    fn lifecycle_state_records_lower_handles_and_resets_them() {
        let mut process = 0u8;
        let mut stdout = 0u8;
        let mut stderr = 0u8;

        let process = ProcessHandle::from_ptr(core::ptr::from_mut(&mut process)).unwrap();
        let stdout = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut stdout)).unwrap();
        let stderr = BufferedReaderHandle::from_ptr(core::ptr::from_mut(&mut stderr)).unwrap();

        let mut state = LifecycleScriptState::new(
            ScriptsList {
                items: [
                    Some(Box::<[u8]>::from(b"preinstall".as_slice())),
                    None,
                    None,
                    None,
                    None,
                    None,
                ],
                first_index: 0,
                total: 1,
                cwd: ZBox::from_bytes(b"/tmp/pkg"),
                package_name: Box::<[u8]>::from(b"pkg".as_slice()),
            },
            false,
            false,
            None,
        );

        state.initialize_exit_state_from_handle(process);
        state.record_stdout_reader(stdout);
        state.record_stderr_reader(stderr);

        assert_eq!(state.process_handle, Some(process));
        assert_eq!(state.stdout_reader, Some(stdout));
        assert_eq!(state.stderr_reader, Some(stderr));
        assert!(state.matches_process_handle(process));

        state.reset_exit_state();

        assert_eq!(state.process_handle, None);
        assert_eq!(state.stdout_reader, None);
        assert_eq!(state.stderr_reader, None);
    }
}
