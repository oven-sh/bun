use crate::id::StrId;
use crate::ir::{Def, Func, Op, Program, func_flags};
use crate::positions::{object_pos, skip_assertions};
use bun_sema::atom::Atom;
use bun_sema::check::Program as Checked;
use bun_sema::hir::{ClassId, ExprId, ExprKind};
use bun_sema::program::FileId;
use bun_sema::util::{InParallel, for_each_mut};
use rustc_hash::{FxHashMap, FxHashSet};

const FUNCTIONS_PER_TASK: usize = 256;
const CHAINS_PER_TASK: usize = 512;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) enum Access {
    Read,
    Call,
    Store,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(super) struct Site {
    pub module: u32,
    pub pos: u32,
    pub name: StrId,
    pub access: Access,
}

pub(super) fn find_sites(program: &Program, is_wanted_module: &[bool], in_parallel: InParallel<'_>) -> Vec<Site> {
    let mut tasks: Vec<(&[Func], Vec<Site>)> = program.funcs.chunks(FUNCTIONS_PER_TASK).map(|funcs| (funcs, Vec::new())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(funcs, found)| {
        let is_searched = |func: &&Func| func.flags & func_flags::IS_TYPED != 0 && func.flags & (func_flags::IS_BUILTIN | func_flags::IS_IN_BUILTIN_MODULE) == 0 && func.module.is_some() && is_wanted_module[func.module.idx()];
        for func in funcs.iter().filter(is_searched) {
            for value in &func.values {
                let (obj, name, access) = match value.def {
                    Def::Op(Op::PropGet { obj, name }) => (obj, name, Access::Read),
                    Def::Op(Op::CallMethod { obj, name, .. }) => (obj, name, Access::Call),
                    Def::Op(Op::PropSet { obj, name, .. }) => (obj, name, Access::Store),
                    _ => continue,
                };
                let receiver = func.values[obj.idx()].ty;
                if !matches!(func.op(obj), Some(Op::FreeGet { .. })) && (receiver.is_none() || program.tys.get(receiver).any_object) {
                    found.push(Site { module: func.module.idx() as u32, pos: value.pos, name, access });
                }
            }
        }
    });
    let mut sites: Vec<Site> = tasks.into_iter().flat_map(|task| task.1).collect();
    sites.sort_unstable();
    sites.dedup();
    sites
}

pub(super) struct Chain {
    pub file: FileId,
    pub receiver: ExprId,
    pub name_pos: u32,
    pub name: Vec<u8>,
    pub sites: Vec<Site>,
    pub begins_with_a_store: bool,
}

pub(super) fn find_chains(program: &Program, checked: &Checked<'_>, modules: &[FileId], sites: &[Site], in_parallel: InParallel<'_>) -> Vec<Chain> {
    let mut tasks: Vec<(&[Site], Vec<Chain>)> = sites.chunk_by(|a, b| a.module == b.module).map(|of_module| (of_module, Vec::new())).collect();
    for_each_mut(&mut tasks, in_parallel, &|(of_module, chains)| {
        let file = modules[of_module[0].module as usize];
        let (hir, atoms) = (checked.files.hir(file), &checked.files.atoms);
        let site_at = |pos: u32, name: Atom, access: Access| {
            let site = Site { module: of_module[0].module, pos, name: program.strs.find(atoms.bytes(name))?, access };
            of_module.binary_search(&site).is_ok().then_some(site)
        };
        let members: Vec<(ExprId, ExprId, Atom, u32, Site)> = (hir.exprs.iter().enumerate())
            .filter_map(|(index, node)| match node.kind {
                ExprKind::Dot { obj, name, name_pos, .. } => {
                    let member = ExprId(index as u32);
                    let at_object = object_pos(hir, member);
                    let site = site_at(at_object, name, Access::Read).or_else(|| site_at(name_pos, name, Access::Call)).or_else(|| site_at(at_object, name, Access::Store)).or_else(|| site_at(name_pos, name, Access::Store));
                    Some((member, obj, name, name_pos, site?))
                }
                _ => None,
            })
            .collect();
        let index_of: FxHashMap<ExprId, usize> = members.iter().enumerate().map(|(index, member)| (member.0, index)).collect();
        let preceding: Vec<Option<usize>> = (members.iter())
            .map(|member| {
                let mut origin = skip_assertions(hir, member.1);
                while let ExprKind::Await(awaited) = hir[origin].kind {
                    origin = skip_assertions(hir, awaited);
                }
                if let ExprKind::Call(call) = hir[origin].kind {
                    origin = skip_assertions(hir, hir[call].callee);
                }
                index_of.get(&origin).copied()
            })
            .collect();
        let mut chain_of_head: FxHashMap<usize, usize> = FxHashMap::default();
        for (index, &(_, receiver, name, name_pos, site)) in members.iter().enumerate().filter(|member| preceding[member.0].is_none()) {
            chain_of_head.insert(index, chains.len());
            chains.push(Chain { file, receiver, name_pos, name: atoms.bytes(name).to_vec(), sites: Vec::new(), begins_with_a_store: site.access == Access::Store });
        }
        for (index, member) in members.iter().enumerate() {
            let mut head = index;
            while let Some(before) = preceding[head] {
                head = before;
            }
            chains[chain_of_head[&head]].sites.push(member.4);
        }
    });
    tasks.into_iter().flat_map(|task| task.1).collect()
}

pub(super) fn count_fixable_reads(program: &Program, checked: &Checked<'_>, modules: &[FileId], classes_without_layout: &FxHashSet<(FileId, ClassId)>, in_parallel: InParallel<'_>) -> usize {
    let sites = find_sites(program, &vec![true; modules.len()], in_parallel);
    let chains: Vec<Chain> = find_chains(program, checked, modules, &sites, in_parallel).into_iter().filter(|chain| !chain.begins_with_a_store).collect();
    let mut tasks: Vec<(&[Chain], usize)> = chains.chunks(CHAINS_PER_TASK).map(|chains| (chains, 0)).collect();
    for_each_mut(&mut tasks, in_parallel, &|(chains, reads)| {
        let receivers: Vec<(FileId, ExprId)> = chains.iter().map(|chain| (chain.file, chain.receiver)).collect();
        let is_fixable = checked.checker().find_fixable_untyped_receivers(&receivers, classes_without_layout);
        let reads_of = |chain: &Chain| chain.sites.iter().filter(|site| site.access == Access::Read).count();
        *reads = chains.iter().zip(is_fixable).filter(|chain| chain.1).map(|chain| reads_of(chain.0)).sum();
    });
    tasks.iter().map(|task| task.1).sum()
}
