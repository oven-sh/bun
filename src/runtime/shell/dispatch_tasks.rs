//! Forward-decl shell task types referenced by `runtime::dispatch::run_task`.
//!
//! Several shell task types collapsed into the NodeId-arena state machine
//! (`interpreter.rs`); the rest are gated behind `interpreter_body_gated.rs`.
//! The high-tier dispatcher must still cast the erased `Task.ptr` to a
//! concrete type and call the per-type entry point, so the shapes are
//! declared here. Bodies that already exist elsewhere re-export through this
//! module; the rest carry the body inline (mostly `run_from_main_thread()` →
//! resume the parent state via NodeId).

use crate::shell::interpreter::{Interpreter, NodeId, ShellTask};
use crate::shell::states::expansion::Expansion;
use bun_collections::smallvec::SmallVec;
use bun_core::strings;
/// Task payload for [`ShellAsync`](crate::shell::states::r#async::Async)'s
/// bounce back to the main thread. The state lives in `interp.nodes`, so
/// the enqueued payload is `(interp, node)`.
#[repr(C)]
pub(crate) struct ShellAsyncTask {
    pub interp: *mut Interpreter,
    pub node: NodeId,
}

/// Stat task backing shell conditional expressions (`[ -f x ]` etc.). Wraps an
/// inner [`ShellTask`].
#[repr(C)]
pub(crate) struct ShellCondExprStatTask {
    pub task: CondExprStatInner,
}

#[repr(C)]
pub(crate) struct CondExprStatInner {
    pub task: ShellTask,
    pub cond: NodeId,
    pub stat: bun_sys::Result<bun_sys::Stat>,
    pub path: Vec<u8>,
    /// The shell env's cwd fd, captured at schedule time so
    /// `run_from_thread_pool` can
    /// `statat` without touching the interpreter off-thread.
    pub cwd_fd: bun_sys::Fd,
}

impl ShellCondExprStatTask {
    /// # Safety
    /// `this` must be a live `heap::alloc` payload paired with the schedule
    /// site. Ownership of `*this` is consumed.
    pub(crate) fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: live Box'd task; paired with `heap::alloc` at schedule time.
        let owned = unsafe { bun_core::heap::take(this) };
        crate::shell::states::cond_expr::CondExpr::on_stat_task_done(
            interp,
            owned.task.cond,
            &owned.task.stat,
            &owned.task.path,
        );
    }
}

/// Error result of a glob-expansion task.
pub(crate) enum ShellGlobErr {
    Syscall(bun_sys::Error),
    Unknown(crate::Error),
}

/// One word of a glob task.
pub(crate) enum ShellGlobJob {
    /// The script wrote no `*` in the word: it is argv as it is.
    Final(Vec<u8>),
    /// `meta_offsets` are the bytes of `word` that the script wrote as pattern syntax. `matches` is for the task.
    Pattern {
        word: Vec<u8>,
        meta_offsets: Vec<u32>,
        matches: Vec<Vec<u8>>,
    },
}

/// The words of a glob task in argv order: the brace variants of a word, or the word when no brace expanded.
pub(crate) type ShellGlobJobs = SmallVec<[ShellGlobJob; 1]>;

/// Glob-expansion task run off the JS thread during word expansion.
#[repr(C)]
pub(crate) struct ShellGlobTask {
    pub task: ShellTask,
    pub expansion: NodeId,
    pub jobs: ShellGlobJobs,
    pub cwd: Vec<u8>,
    pub err: Option<ShellGlobErr>,
}

impl bun_event_loop::Taskable for ShellGlobTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellGlobTask;
    /// A pool completion that will not run: drop the keep-alive and the box
    /// (nothing else frees an unrun one).
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box the builtin scheduled.
        unsafe {
            (*this).task.unref_unrun();
            drop(bun_core::heap::take(this));
        }
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellGlobTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        let mut next = 0;
        while next < this.jobs.len() {
            let len = Self::shared_walk_len(&this.jobs[next..]);
            let jobs = &mut this.jobs[next..next + len];
            next += len;
            // The VM releases the completion unrun, so the walks that are left have no reader.
            if this.task.cancelled() {
                return;
            }
            let err = match Self::walk_impl(jobs, &this.cwd) {
                Ok(Ok(())) => continue,
                // A directory that the word names is not there: the matches so far are all of them.
                Ok(Err(e)) if matches!(e.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
                    continue;
                }
                Ok(Err(e)) => ShellGlobErr::Syscall(e),
                Err(e) => ShellGlobErr::Unknown(e),
            };
            // The jobs of a walk that failed have no match. The error is for a word in which no job has one.
            for job in jobs {
                if let ShellGlobJob::Pattern { matches, .. } = job {
                    matches.clear();
                }
            }
            this.err.get_or_insert(err);
        }
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: paired with `heap::alloc` in `create_and_schedule`.
        let mut me = unsafe { bun_core::heap::take(this) };
        Expansion::on_glob_walk_done(
            interp,
            me.expansion,
            core::mem::take(&mut me.jobs),
            me.err.take(),
        );
    }
}

impl ShellGlobTask {
    /// Heap-allocate the glob task for `expansion` and schedule it on the
    /// work pool; the allocation is freed in `run_from_main_thread`.
    pub(crate) fn create_and_schedule(
        interp: &Interpreter,
        expansion: NodeId,
        jobs: ShellGlobJobs,
        cwd: Vec<u8>,
    ) {
        let mut task = ShellTask::new(interp.event_loop);
        task.interp = interp.as_ctx_ptr();
        let this = bun_core::heap::alloc(ShellGlobTask {
            task,
            expansion,
            jobs,
            cwd,
            err: None,
        });
        // SAFETY: `this` is a fresh heap allocation embedding `ShellTask` at
        // `TASK_OFFSET`; freed in `run_from_main_thread`.
        unsafe { ShellTask::schedule::<ShellGlobTask>(this) };
    }

    /// Where the last path component of `path` starts.
    fn last_component_start(path: &[u8]) -> usize {
        let separators: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };
        strings::last_index_of_any(path, separators).map_or(0, |separator| separator + 1)
    }

    /// What jobs must have in common to share a walk, or `None` for a job that the walker reads in another way in a group.
    fn shared_prefix(job: &ShellGlobJob) -> Option<(&[u8], &[u32])> {
        let ShellGlobJob::Pattern {
            word, meta_offsets, ..
        } = job
        else {
            return None;
        };
        let start = Self::last_component_start(word);
        let (prefix_meta, last_meta) = meta_offsets
            .split_at(meta_offsets.partition_point(|&offset| (offset as usize) < start));
        let last = &word[start..];
        let splits_a_group = last_meta
            .iter()
            .any(|&offset| word[offset as usize] != b'*');
        let is_globstar = last_meta
            .iter()
            .zip(last_meta.iter().skip(1))
            .any(|(star, next)| star + 1 == *next);
        let names_dot_files = last.first() == Some(&b'.');
        if last.is_empty()
            || splits_a_group
            || is_globstar
            || names_dot_files
            || !bun_core::is_all_ascii(last)
        {
            return None;
        }
        Some((&word[..start], prefix_meta))
    }

    /// How many jobs at the front of `jobs` one walk serves: `src/{*.ts,*.tsx}` reads `src` once for `src/*.{ts,tsx}`.
    fn shared_walk_len(jobs: &[ShellGlobJob]) -> usize {
        let shared = match jobs {
            [first, _, ..] => Self::shared_prefix(first),
            _ => None,
        };
        let Some(shared) = shared else {
            return 1;
        };
        1 + jobs[1..]
            .iter()
            .take_while(|job| Self::shared_prefix(job) == Some(shared))
            .count()
    }

    /// One walk for `jobs`: one job, or the jobs that `shared_walk_len` put together.
    fn walk_impl(
        jobs: &mut [ShellGlobJob],
        cwd: &[u8],
    ) -> Result<bun_sys::Result<()>, crate::Error> {
        let mut patterns: SmallVec<[Vec<u8>; 1]> = SmallVec::new();
        let mut results: SmallVec<[&mut Vec<Vec<u8>>; 1]> = SmallVec::new();
        for job in jobs {
            if let ShellGlobJob::Pattern {
                word,
                meta_offsets,
                matches,
            } = job
            {
                patterns.push(Expansion::neutralize_glob_metachars(word, meta_offsets));
                results.push(matches);
            }
        }
        let Some(first) = patterns.first() else {
            return Ok(Ok(()));
        };
        // The patterns of a shared walk are the same before `last`, where their last path component starts.
        let mut last = 0;
        let mut group: Vec<u8> = Vec::new();
        if patterns.len() > 1 {
            last = Self::last_component_start(first);
            group.extend_from_slice(&first[..last]);
            for (i, pattern) in patterns.iter().enumerate() {
                group.push(if i == 0 { b'{' } else { b',' });
                group.extend_from_slice(&pattern[last..]);
            }
            group.push(b'}');
        }
        let pattern: &[u8] = if patterns.len() > 1 { &group } else { first };
        let mut walker = match bun_glob::BunGlobWalkerZ::init_with_cwd(
            pattern, cwd, false, false, false, false, false, None,
        )? {
            Ok(walker) => walker,
            Err(e) => return Ok(Err(e)),
        };
        let mut iter = bun_glob::walk::Iterator::new(&mut walker);
        if let Err(e) = iter.init()? {
            return Ok(Err(e));
        }
        loop {
            match iter.next()? {
                Err(e) => return Ok(Err(e)),
                Ok(None) => return Ok(Ok(())),
                Ok(Some(path)) => {
                    // The walker SENTINEL=true variant NUL-terminates; strip
                    // it so the argv word boundary doesn't carry an embedded 0.
                    let bytes = if path.last() == Some(&0) {
                        &path[..path.len() - 1]
                    } else {
                        &path[..]
                    };
                    if let [result] = &mut results[..] {
                        result.push(bytes.to_vec());
                        continue;
                    }
                    // A path of a shared walk is a match of each job whose own last component matches its name.
                    let name = &bytes[Self::last_component_start(bytes)..];
                    for (pattern, result) in patterns.iter().zip(results.iter_mut()) {
                        if bun_glob::r#match(&pattern[last..], name).matches() {
                            result.push(bytes.to_vec());
                        }
                    }
                }
            }
        }
    }
}

/// A child node in the
/// recursive rm tree-walk; posts back to main when its subtree is empty.
/// Re-export: the real DirTask lives in `builtins::rm` (full recursive
/// tree-walk node). `dispatch.rs` calls `ShellRmDirTask::run_from_main_thread`
/// for the verbose-write bounce-back.
pub(crate) use crate::shell::builtins::rm::DirTask as ShellRmDirTask;
