//! In pipeline expressions, assigns (e.g. `FOO=bar BAR=baz | echo hi`) have
//! no effect on the environment of the shell, so we can skip them.

use core::mem::MaybeUninit;

use bun_shell::ast;
use bun_shell::interpret::{EnvStr, StatePtrUnion};
use bun_shell::interpreter::{
    Binary, Cmd, Expansion, Interpreter, Pipeline, ShellExecEnv, State, Stmt, IO,
};
use bun_shell::{ExitCode, ShellErr, Yield};

// TODO(port): `log` is `bun.shell.interpret.log` (Output.scoped). Declare the
// scope once at the `interpret` module level and re-export the macro.
use bun_shell::interpret::log;

pub struct Assigns {
    pub base: State,
    // TODO(port): lifetime — borrowed from the shell AST arena (never freed here).
    pub node: *const [ast::Assign],
    pub parent: ParentPtr,
    pub state: AssignsState,
    pub ctx: AssignCtx,
    pub owned: bool, // = true
    pub io: IO,
}

pub enum AssignsState {
    Idle,
    Expanding(ExpandingState),
    Err(ShellErr),
    Done,
}

pub struct ExpandingState {
    pub idx: u32, // = 0
    // TODO(port): element type was `[:0]const u8` (NUL-terminated, heap-owned).
    // Expansion pushes allocated slices; ownership is transferred to EnvStr or
    // dropped here. Using Box<[u8]> for now; revisit if NUL sentinel is needed.
    pub current_expansion_result: Vec<Box<[u8]>>,
    pub expansion: MaybeUninit<Expansion>,
}

pub type ParentPtr = StatePtrUnion<(Stmt, Binary, Cmd, Pipeline)>;

pub type ChildPtr = StatePtrUnion<(Expansion,)>;

impl Assigns {
    // TODO(port): not `impl Drop` — this is a state-machine node whose storage
    // is parent-managed (`parent.destroy(self)` deallocates the slot). The
    // guide forbids exposing `pub fn deinit`; keep an explicit `destroy`
    // teardown invoked by the parent after `childDone` (BACKREF storage,
    // cannot take `self` by value).
    #[inline]
    pub fn destroy(&mut self) {
        match &mut self.state {
            AssignsState::Expanding(e) => {
                // Vec<Box<[u8]>> drops elements on drop.
                drop(core::mem::take(&mut e.current_expansion_result));
            }
            AssignsState::Err(e) => e.deinit(),
            AssignsState::Idle | AssignsState::Done => {}
        }
        self.io.deinit();
        self.base.end_scope();
        if self.owned {
            self.parent.destroy(self);
        }
    }

    pub fn start(&mut self) -> Yield {
        Yield::Assigns(self)
    }

    pub fn init(
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: *const [ast::Assign],
        ctx: AssignCtx,
        parent: ParentPtr,
        io: IO,
    ) -> *mut Assigns {
        // TODO(port): in-place init — `parent.create::<Assigns>()` returns a
        // pre-allocated slot (BACKREF; parent owns storage).
        let this: *mut Assigns = parent.create::<Assigns>();
        log!("Assigns(0x{:x}) init", this as usize);
        // SAFETY: `parent.create` returns a valid uninitialized slot for Assigns.
        unsafe {
            this.write(Assigns {
                base: State::init_with_new_alloc_scope(State::Kind::Assign, interpreter, shell_state),
                node,
                parent,
                state: AssignsState::Idle,
                ctx,
                owned: true,
                io,
            });
        }
        this
    }

    pub fn init_borrowed(
        // TODO(port): in-place init into caller-owned storage (embedded in Cmd).
        this: &mut MaybeUninit<Assigns>,
        interpreter: &mut Interpreter,
        shell_state: &mut ShellExecEnv,
        node: *const [ast::Assign],
        ctx: AssignCtx,
        parent: ParentPtr,
        io: IO,
    ) {
        this.write(Assigns {
            base: State::init_with_new_alloc_scope(State::Kind::Assign, interpreter, shell_state),
            node,
            parent,
            state: AssignsState::Idle,
            ctx,
            owned: false,
            io,
        });
    }

    pub fn next(&mut self) -> Yield {
        while !matches!(self.state, AssignsState::Done) {
            match &mut self.state {
                AssignsState::Idle => {
                    self.state = AssignsState::Expanding(ExpandingState {
                        idx: 0,
                        current_expansion_result: Vec::new(),
                        expansion: MaybeUninit::uninit(),
                    });
                    continue;
                }
                AssignsState::Expanding(expanding) => {
                    // SAFETY: `node` borrows from the AST arena which outlives this state.
                    let node = unsafe { &*self.node };
                    if expanding.idx as usize >= node.len() {
                        expanding.current_expansion_result = Vec::new(); // clearAndFree
                        self.state = AssignsState::Done;
                        continue;
                    }

                    Expansion::init(
                        self.base.interpreter,
                        self.base.shell,
                        &mut expanding.expansion,
                        &node[expanding.idx as usize].value,
                        Expansion::ParentPtr::init(self),
                        Expansion::OutKind::ArrayOfSlice(&mut expanding.current_expansion_result),
                        self.io.copy(),
                    );
                    // SAFETY: Expansion::init just initialized `expanding.expansion`.
                    return unsafe { expanding.expansion.assume_init_mut() }.start();
                }
                AssignsState::Done => unreachable!(),
                AssignsState::Err(_) => return self.parent.child_done(self, 1),
            }
        }

        self.parent.child_done(self, 0)
    }

    pub fn child_done(&mut self, child: ChildPtr, exit_code: ExitCode) -> Yield {
        if child.ptr.is::<Expansion>() {
            debug_assert!(matches!(self.state, AssignsState::Expanding(_)));
            let expansion = child.ptr.as_::<Expansion>();
            if exit_code != 0 {
                // `expansion` points into `self.state.expanding.expansion`; capture the error
                // and deinit it before switching the union variant or we operate on garbage.
                let err = expansion.state.err;
                if let AssignsState::Expanding(e) = &mut self.state {
                    e.current_expansion_result = Vec::new(); // clearAndFree
                }
                expansion.deinit();
                self.state = AssignsState::Err(err);
                return Yield::Failed;
            }
            // PORT NOTE: reshaped for borrowck — re-borrow `expanding` after the early return.
            let AssignsState::Expanding(expanding) = &mut self.state else {
                unreachable!()
            };

            // SAFETY: `node` borrows from the AST arena which outlives this state.
            let node = unsafe { &*self.node };
            let label = &node[expanding.idx as usize].label;

            // Did it expand to a single word?
            if expanding.current_expansion_result.len() == 1 {
                let value = expanding.current_expansion_result.swap_remove(0);
                // We're going to let `EnvStr` manage the allocation for `value`
                // from here on out
                self.base.leak_slice(&value);
                expanding.current_expansion_result = Vec::new(); // clearAndFree

                // TODO(port): EnvStr ref-counting — `init_ref_counted` takes ownership of
                // the leaked allocation; `ref_` is dropped (deref'd) at end of scope.
                let ref_ = EnvStr::init_ref_counted(Box::leak(value));

                self.base.shell.assign_var(
                    self.base.interpreter,
                    EnvStr::init_slice(label),
                    ref_,
                    self.ctx,
                );
            } else {
                // Multiple words, need to concatenate them together. First
                // calculate size of the total buffer.
                let size: usize = 'brk: {
                    let mut total: usize = 0;
                    let last = expanding.current_expansion_result.len().saturating_sub(1);
                    for (i, slice) in expanding.current_expansion_result.iter().enumerate() {
                        total += slice.len();
                        if i != last {
                            // Let's not forget to count the space in between the
                            // words!
                            total += 1;
                        }
                    }
                    break 'brk total;
                };

                let value: Box<[u8]> = 'brk: {
                    if size == 0 {
                        break 'brk Box::<[u8]>::default();
                    }
                    // PERF(port): was `allocator().alloc(u8, size)` (arena/scope alloc).
                    let mut merged = vec![0u8; size].into_boxed_slice();
                    let mut i: usize = 0;
                    let last = expanding.current_expansion_result.len().saturating_sub(1);
                    for (j, slice) in expanding.current_expansion_result.iter().enumerate() {
                        merged[i..i + slice.len()].copy_from_slice(&slice[..slice.len()]);
                        i += slice.len();
                        if j != last {
                            merged[i] = b' ';
                            i += 1;
                        }
                    }
                    break 'brk merged;
                };

                // We're going to let `EnvStr` manage the allocation for `value`
                // from here on out
                self.base.leak_slice(&value);

                // TODO(port): EnvStr ref-counting — dropped (deref'd) at end of scope.
                let value_ref = EnvStr::init_ref_counted(Box::leak(value));

                self.base.shell.assign_var(
                    self.base.interpreter,
                    EnvStr::init_slice(label),
                    value_ref,
                    self.ctx,
                );
                // PORT NOTE: Zig loops `allocator().free(slice)` then
                // `clearRetainingCapacity()`. With `Vec<Box<[u8]>>`, `.clear()`
                // drops every element, which is the same effect.
                expanding.current_expansion_result.clear();
            }

            expanding.idx += 1;
            expansion.deinit();
            return Yield::Assigns(self);
        }

        panic!("Invalid child to Assigns expression, this indicates a bug in Bun. Please file a report on Github.");
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum AssignCtx {
    Cmd,
    Shell,
    Exported,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Assigns.zig (236 lines)
//   confidence: medium
//   todos:      7
//   notes:      parent-managed storage (BACKREF) kept as explicit `destroy` (not Drop, not deinit); node slice + expansion result element ownership need lifetime review in Phase B
// ──────────────────────────────────────────────────────────────────────────
