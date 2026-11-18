//! The client: wherever it is asked for code it calls the harness, and notes what it was told of the place.

use std::collections::{HashMap, HashSet};

use bun_engine_asm::{FloatAssembly, FloatWidth, Label, Reg, RegisterSet};
use bun_engine_codegen::ir::{Action, Function, Location, Op, Origin, Token};
use bun_engine_codegen::{CallSite, Client, ExitSite, Frame, PatchpointSite};

use crate::support::random::mix;
use crate::support::vocabulary::sites;

pub(super) enum Kind {
    Exit,
    Patchpoint {
        results: Vec<Location>,
        operands: Vec<Location>,
        live_registers: RegisterSet,
        live_vectors: RegisterSet,
        falls_through_to: Option<usize>,
    },
    Call,
}

/// A place at which the harness takes over.
pub(super) struct Stop {
    pub(super) kind: Kind,
    pub(super) token: Token,
    pub(super) state: Vec<Location>,
    /// What the client was free to overwrite at once.
    pub(super) scratch: RegisterSet,
    /// Successors or handlers.
    pub(super) labels: Vec<Label>,
}

pub(super) struct Recorder {
    harness: usize,
    seed: u64,
    without_state: HashSet<Token>,
    custom_calls: HashSet<Token>,
    announced_call: Option<Token>,
    shared_exits: HashMap<Token, Label>,
    /// Where the code starts, and where it goes back to.
    out_of_line: Vec<(Label, Option<Label>, Stop)>,
    /// By return address.
    pub(super) stops: Vec<(Label, Stop)>,
}

fn scratch_of(masm: &impl FloatAssembly) -> RegisterSet {
    let scratch = masm.scratch();
    let gprs = scratch.gprs.into_iter().flatten().map(Reg::from);
    gprs.chain(scratch.fprs.into_iter().flatten().map(Reg::from))
        .collect()
}

impl Recorder {
    pub(super) fn new(function: &Function, harness: usize, seed: u64) -> Self {
        let has_no_state = |&(_, site): &_| function.state(function.state_of(site)).is_empty();
        let without_state = sites(function).into_iter().filter(has_no_state);
        let is_custom_call = |&(_, site): &_| {
            matches!(*function.op(site), Op::Patchpoint(patchpoint)
                if function.patchpoint(patchpoint).action == Action::CustomCall)
        };
        let custom_calls = sites(function).into_iter().filter(is_custom_call);
        Self {
            harness,
            seed,
            without_state: without_state.map(|(token, _)| token).collect(),
            custom_calls: custom_calls.map(|(token, _)| token).collect(),
            announced_call: None,
            shared_exits: HashMap::new(),
            out_of_line: Vec::new(),
            stops: Vec::new(),
        }
    }

    fn one_in(&self, count: u64, token: Token) -> bool {
        mix(self.seed, token.0.into()).is_multiple_of(count)
    }

    fn overwrite_scratch(&self, masm: &mut impl FloatAssembly) {
        let scratch = scratch_of(masm);
        for reg in scratch.fprs() {
            masm.move_float_constant(FloatWidth::F64, reg, self.seed | 1);
        }
        for reg in scratch.gprs() {
            masm.move64(reg, self.seed | 1 << 62);
        }
    }

    fn call_harness(&mut self, masm: &mut impl FloatAssembly, stop: Stop) {
        masm.call_address(self.harness);
        self.stops.push((masm.mark(), stop));
    }
}

impl<M: FloatAssembly> Client<M> for Recorder {
    fn prologue(&mut self, masm: &mut M, _: usize, frame: &Frame) {
        masm.enter_frame();
        masm.sub64(M::STACK_POINTER, M::STACK_POINTER, frame.size);
        self.overwrite_scratch(masm);
    }

    fn shared_exit(&mut self, masm: &mut M, token: Token) -> Option<Label> {
        if !self.without_state.contains(&token) || self.one_in(2, token) {
            return None;
        }
        Some(*self.shared_exits.entry(token).or_insert_with(|| {
            let label = masm.new_label();
            let stop = Stop {
                kind: Kind::Exit,
                token,
                state: Vec::new(),
                scratch: RegisterSet::EMPTY,
                labels: Vec::new(),
            };
            self.out_of_line.push((label, None, stop));
            label
        }))
    }

    fn exit(&mut self, masm: &mut M, site: &ExitSite<'_>) {
        let stop = Stop {
            kind: Kind::Exit,
            token: site.token,
            state: site.state.iter().collect(),
            scratch: scratch_of(masm),
            labels: Vec::new(),
        };
        self.call_harness(masm, stop);
        masm.breakpoint();
    }

    fn patchpoint(&mut self, masm: &mut M, site: &PatchpointSite<'_>) {
        let gprs = site.scratch_gprs.iter().copied().map(Reg::from);
        let fprs = site.scratch_fprs.iter().copied().map(Reg::from);
        let stop = Stop {
            kind: Kind::Patchpoint {
                results: site.results.to_vec(),
                operands: site.operands.to_vec(),
                live_registers: site.live_registers,
                live_vectors: site.live_vectors,
                falls_through_to: site.falls_through_to,
            },
            token: site.token,
            state: site.state.iter().collect(),
            scratch: scratch_of(masm) | gprs.chain(fprs).collect(),
            labels: site.successors.to_vec(),
        };
        if self.one_in(8, site.token) && !self.custom_calls.contains(&site.token) {
            let (start, back) = (masm.new_label(), masm.new_label());
            masm.jump(start);
            masm.bind(back);
            self.out_of_line.push((start, Some(back), stop));
        } else {
            self.call_harness(masm, stop);
        }
    }

    fn before_call(&mut self, masm: &mut M, token: Token, _: Origin) {
        self.announced_call = Some(token);
        self.overwrite_scratch(masm);
    }

    fn after_call(&mut self, masm: &mut M, site: &CallSite<'_>) {
        assert_eq!(self.announced_call.take(), Some(site.token));
        let (kind, scratch) = if self.custom_calls.contains(&site.token) {
            let (_, stop) = self.stops.pop().unwrap();
            (stop.kind, stop.scratch)
        } else {
            (Kind::Call, scratch_of(masm))
        };
        let stop = Stop {
            kind,
            token: site.token,
            state: site.state.iter().collect(),
            scratch,
            labels: site.handlers.to_vec(),
        };
        self.stops.push((site.return_address, stop));
    }

    fn out_of_line(&mut self, masm: &mut M) {
        for (start, back, stop) in std::mem::take(&mut self.out_of_line) {
            masm.bind(start);
            self.call_harness(masm, stop);
            match back {
                Some(back) => masm.jump(back),
                None => masm.breakpoint(),
            }
        }
    }
}
