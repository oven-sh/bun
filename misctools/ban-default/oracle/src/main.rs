#![feature(rustc_private)]
#![allow(clippy::all)]
extern crate rustc_ast;
extern crate rustc_data_structures;
extern crate rustc_driver;
extern crate rustc_hir;
extern crate rustc_interface;
extern crate rustc_middle;
extern crate rustc_session;
extern crate rustc_span;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::io::Write as _;

use rustc_driver::{Callbacks, Compilation};
use rustc_hir as hir;
use rustc_hir::def::{CtorOf, DefKind, Res};
use rustc_hir::def_id::{CrateNum, DefId, LOCAL_CRATE, LocalDefId, LocalModId};
use rustc_hir::intravisit::{self, Visitor};
use rustc_middle::ty::print::{with_crate_prefix, with_no_trimmed_paths};
use rustc_middle::ty::{self, Ty, TyCtxt};
use rustc_span::{Span, sym};

mod json;
use json::J;

struct Oracle;

impl Callbacks for Oracle {
    fn after_analysis<'tcx>(
        &mut self,
        _compiler: &rustc_interface::interface::Compiler,
        tcx: TyCtxt<'tcx>,
    ) -> Compilation {
        analyze(tcx);
        Compilation::Continue
    }
}

fn main() {
    let mut args: Vec<String> = std::env::args().collect();
    // RUSTC_WORKSPACE_WRAPPER: argv = [wrapper, rustc, rustc args...]
    args.remove(0);
    if !args.iter().any(|a| a == "--sysroot") {
        if let Ok(s) = std::env::var("ORACLE_SYSROOT") {
            args.push("--sysroot".into());
            args.push(s);
        }
    }
    rustc_driver::run_compiler(&args, &mut Oracle);
}

struct Cx<'tcx> {
    tcx: TyCtxt<'tcx>,
    default_trait: DefId,
    default_fn: Option<DefId>,
    root: String,
    krate: String,
    out: Vec<String>,
    scopes: RefCell<HashMap<LocalModId, Rc<Vec<(DefId, String, DefId)>>>>,
    ws_crates: RefCell<HashMap<CrateNum, bool>>,
}

/// Where an expression will be written: decides how a type can be named there.
#[derive(Clone, Copy)]
struct Site {
    module: LocalModId,
    def: LocalDefId,
}

impl<'tcx> Cx<'tcx> {
    fn file_of(&self, span: Span) -> String {
        let sm = self.tcx.sess.source_map();
        let f = sm.lookup_source_file(span.lo());
        format!("{}", f.name.prefer_local_unconditionally())
    }

    fn is_workspace_file(&self, file: &str) -> bool {
        if file.starts_with('/') {
            file.starts_with(&self.root)
                && !file[self.root.len()..].starts_with("/vendor/")
                && !file.contains("/target/")
                && !file.contains("/build/")
        } else {
            file.starts_with("src/") || file.starts_with("packages/")
        }
    }

    fn is_workspace_def(&self, did: DefId) -> bool {
        let krate = did.krate;
        if let Some(b) = self.ws_crates.borrow().get(&krate) {
            return *b;
        }
        let span = self.tcx.def_span(krate.as_def_id());
        let b = if span.is_dummy() {
            false
        } else {
            let f = self.file_of(span);
            self.is_workspace_file(&f)
        };
        self.ws_crates.borrow_mut().insert(krate, b);
        b
    }

    /// Type names that are in scope in module `m`: (type, name, the item whose visibility governs the name).
    fn scope(&self, m: LocalModId, depth: usize) -> Rc<Vec<(DefId, String, DefId)>> {
        if let Some(s) = self.scopes.borrow().get(&m) {
            return s.clone();
        }
        let tcx = self.tcx;
        let mut defs: Vec<(DefId, String, DefId)> = Vec::new();
        let mut uses: Vec<(DefId, String, DefId)> = Vec::new();
        let mut globs: Vec<DefId> = Vec::new();
        let is_adt = |k: DefKind| matches!(k, DefKind::Struct | DefKind::Enum | DefKind::Union);
        for id in tcx.hir_module_free_items(m) {
            let item = tcx.hir_item(id);
            let local = item.owner_id.def_id;
            if tcx.opt_local_parent(local) != Some(m.to_local_def_id()) {
                continue;
            }
            let did = local.to_def_id();
            let kind = tcx.def_kind(did);
            if is_adt(kind) {
                defs.push((did, tcx.item_name(did).to_string(), did));
            } else if let hir::ItemKind::Use(path, ukind) = item.kind {
                match ukind {
                    hir::UseKind::Single(ident) => {
                        if let Some(Res::Def(k, t)) = path.res.type_ns {
                            if is_adt(k) {
                                uses.push((t, ident.name.to_string(), did));
                            }
                        }
                    }
                    hir::UseKind::Glob => {
                        if let Some(Res::Def(DefKind::Mod, md)) = path.res.type_ns {
                            globs.push(md);
                        }
                    }
                    _ => {}
                }
            }
        }
        let mut all = defs;
        all.extend(uses);
        if depth < 3 {
            for md in globs {
                if let Some(l) = md.as_local() {
                    if l == m.to_local_def_id() {
                        continue;
                    }
                    let target = LocalModId::new_unchecked(l);
                    let inner = self.scope(target, depth + 1);
                    for (t, name, holder) in inner.iter() {
                        if tcx.visibility(*holder).is_accessible_from(m.to_def_id(), tcx) {
                            all.push((*t, name.clone(), *holder));
                        }
                    }
                } else {
                    for c in tcx.module_children(md) {
                        if let Res::Def(k, t) = c.res {
                            if is_adt(k) && c.vis.is_public() {
                                all.push((t, c.ident.name.to_string(), t));
                            }
                        }
                    }
                }
            }
        }
        let rc = Rc::new(all);
        if depth == 0 {
            self.scopes.borrow_mut().insert(m, rc.clone());
        }
        rc
    }

    /// A path that names `adt` at `site`, and whether we are confident that it resolves.
    fn site_path(&self, adt: DefId, site: Site) -> (String, bool) {
        let tcx = self.tcx;
        let name = tcx.item_name(adt).to_string();
        if let Some(local) = adt.as_local() {
            // a type declared inside a function body can only be named from inside that body
            let parent = tcx.local_parent(local);
            if tcx.def_kind(parent) != DefKind::Mod {
                let ok = tcx.is_descendant_of(site.def.to_def_id(), parent.to_def_id());
                return (name, ok);
            }
        }
        let lookup = |m: LocalModId| -> Option<String> {
            let sc = self.scope(m, 0);
            // definitions and single imports come first in the list; the first hit wins
            sc.iter().find(|(t, _, _)| *t == adt).map(|(_, n, _)| n.clone())
        };
        if let Some(n) = lookup(site.module) {
            return (n, true);
        }
        let mut m = site.module;
        let mut prefix = String::new();
        for _ in 0..2 {
            if m.is_top_level_module() {
                break;
            }
            m = tcx.parent_module_from_def_id(m.to_local_def_id());
            prefix.push_str("super::");
            if let Some(n) = lookup(m) {
                return (format!("{prefix}{n}"), true);
            }
        }
        let printed = with_crate_prefix!(with_no_trimmed_paths!(tcx.def_path_str(adt)));
        if let Some(local) = adt.as_local() {
            // every module on the definition path must be visible from the site
            let mut ok = tcx.visibility(adt).is_accessible_from(site.module.to_def_id(), tcx);
            let mut cur = tcx.parent_module_from_def_id(local);
            while ok && !cur.is_top_level_module() {
                ok = tcx.visibility(cur.to_def_id()).is_accessible_from(site.module.to_def_id(), tcx);
                cur = tcx.parent_module_from_def_id(cur.to_local_def_id());
            }
            return (printed, ok);
        }
        (printed, false)
    }

    fn span_json(&self, span: Span) -> J {
        let sm = self.tcx.sess.source_map();
        let from_exp = span.from_expansion();
        let mut o = J::obj();
        if span.is_dummy() {
            o.set("dummy", J::Bool(true));
            return o;
        }
        let lo = sm.lookup_byte_offset(span.lo());
        let hi = sm.lookup_byte_offset(span.hi());
        let file = format!("{}", lo.sf.name.prefer_local_unconditionally());
        let line = sm.lookup_char_pos(span.lo()).line;
        o.set("file", J::Str(self.rel(&file)));
        o.set("lo", J::Num(lo.pos.0 as i64));
        o.set("hi", J::Num(hi.pos.0 as i64));
        o.set("line", J::Num(line as i64));
        o.set("exp", J::Bool(from_exp));
        if from_exp {
            let data = span.ctxt().outer_expn_data();
            o.set("macro", J::Str(format!("{:?}", data.kind)));
            let cs = span.source_callsite();
            if !cs.is_dummy() {
                let clo = sm.lookup_byte_offset(cs.lo());
                let chi = sm.lookup_byte_offset(cs.hi());
                let cfile = format!("{}", clo.sf.name.prefer_local_unconditionally());
                let mut c = J::obj();
                c.set("file", J::Str(self.rel(&cfile)));
                c.set("lo", J::Num(clo.pos.0 as i64));
                c.set("hi", J::Num(chi.pos.0 as i64));
                c.set("line", J::Num(sm.lookup_char_pos(cs.lo()).line as i64));
                o.set("callsite", c);
            }
        }
        o
    }

    fn rel(&self, file: &str) -> String {
        if let Some(r) = file.strip_prefix(&self.root) {
            r.trim_start_matches('/').to_string()
        } else {
            file.to_string()
        }
    }

    fn snippet(&self, span: Span) -> String {
        self.tcx.sess.source_map().span_to_snippet(span).unwrap_or_default()
    }

    fn byte_pos(&self, pos: rustc_span::BytePos) -> i64 {
        self.tcx.sess.source_map().lookup_byte_offset(pos).pos.0 as i64
    }

    fn adt_key(&self, did: DefId) -> J {
        let tcx = self.tcx;
        let mut o = J::obj();
        o.set("krate", J::Str(tcx.crate_name(did.krate).to_string()));
        o.set("path", J::Str(tcx.def_path(did).to_string_no_crate_verbose()));
        o.set("name", J::Str(tcx.item_name(did).to_string()));
        let printed = with_crate_prefix!(with_no_trimmed_paths!(tcx.def_path_str(did)));
        o.set("printed", J::Str(printed));
        o
    }

    fn ty_str(&self, ty: Ty<'tcx>) -> String {
        with_no_trimmed_paths!(ty.to_string())
    }

    fn is_copy(&self, ty: Ty<'tcx>) -> bool {
        // Conservative: primitives and shared refs only. Others go through from_fn.
        matches!(
            ty.kind(),
            ty::Bool | ty::Char | ty::Int(_) | ty::Uint(_) | ty::Float(_) | ty::Ref(_, _, hir::Mutability::Not)
        )
    }

    /// What `<ty as Default>::default()` evaluates to, as a tree the codemod renders.
    fn init_tree(&self, ty: Ty<'tcx>, depth: usize, site: Site) -> J {
        let tcx = self.tcx;
        let lit = |s: &str| {
            let mut o = J::obj();
            o.set("k", J::Str("lit".into()));
            o.set("s", J::Str(s.into()));
            o
        };
        let manual = |why: String| {
            let mut o = J::obj();
            o.set("k", J::Str("manual".into()));
            o.set("why", J::Str(why));
            o
        };
        let wrap = |pre: &str, inner: J, post: &str| {
            let mut o = J::obj();
            o.set("k", J::Str("wrap".into()));
            o.set("pre", J::Str(pre.into()));
            o.set("inner", inner);
            o.set("post", J::Str(post.into()));
            o
        };
        if depth > 8 {
            return manual("too deep".into());
        }
        match ty.kind() {
            ty::Bool => lit("false"),
            ty::Char => lit("'\\0'"),
            ty::Int(_) | ty::Uint(_) | ty::Float(_) => {
                let mut o = lit(if matches!(ty.kind(), ty::Float(_)) { "0.0" } else { "0" });
                o.set("prim", J::Str(self.ty_str(ty)));
                o
            }
            ty::Tuple(tys) => {
                if tys.is_empty() {
                    return lit("()");
                }
                let mut o = J::obj();
                o.set("k", J::Str("tuple".into()));
                o.set("items", J::Arr(tys.iter().map(|t| self.init_tree(t, depth + 1, site)).collect()));
                o
            }
            ty::Array(elem, len) => {
                let mut o = J::obj();
                o.set("k", J::Str("array".into()));
                o.set("elem", self.init_tree(*elem, depth + 1, site));
                o.set("len", J::Str(with_no_trimmed_paths!(len.to_string())));
                o.set("copy", J::Bool(self.is_copy(*elem)));
                o
            }
            ty::Ref(_, inner, hir::Mutability::Not) => match inner.kind() {
                ty::Slice(_) => lit("&[]"),
                ty::Str => lit("\"\""),
                ty::Adt(def, _) if tcx.item_name(def.did()).as_str() == "CStr" => lit("c\"\""),
                _ => manual(format!("ref {}", self.ty_str(ty))),
            },
            ty::Ref(_, inner, hir::Mutability::Mut) => match inner.kind() {
                ty::Slice(_) => lit("&mut []"),
                _ => manual(format!("mut ref {}", self.ty_str(ty))),
            },
            ty::Adt(def, args) => {
                let did = def.did();
                let krate = tcx.crate_name(did.krate);
                let krate = krate.as_str();
                let name = tcx.item_name(did);
                let name = name.as_str();
                if self.is_workspace_def(did) {
                    let mut o = self.adt_key(did);
                    o.set("k", J::Str("local".into()));
                    o.set(
                        "adt_kind",
                        J::Str(if def.is_enum() { "enum" } else if def.is_union() { "union" } else { "struct" }.into()),
                    );
                    o.set("ty", J::Str(self.ty_str(ty)));
                    let (sp, ok) = self.site_path(did, site);
                    o.set("site_path", J::Str(sp));
                    o.set("site_ok", J::Bool(ok));
                    let targs: Vec<J> = args.types().map(|t| self.init_tree(t, depth + 1, site)).collect();
                    if !targs.is_empty() {
                        o.set("targs", J::Arr(targs));
                    }
                    return o;
                }
                if matches!(krate, "core" | "alloc" | "std") {
                    let t0 = || args.types().next();
                    return match name {
                        "Option" => lit("None"),
                        "Vec" => lit("Vec::new()"),
                        "String" => lit("String::new()"),
                        "Box" => match t0().map(|t| t.kind()) {
                            Some(ty::Slice(_)) => lit("Box::new([])"),
                            Some(ty::Str) => lit("String::new().into_boxed_str()"),
                            Some(_) => wrap("Box::new(", self.init_tree(t0().unwrap(), depth + 1, site), ")"),
                            None => manual("Box without type arg".into()),
                        },
                        "Rc" | "Arc" => {
                            let p = if name == "Rc" { "std::rc::Rc::new(" } else { "std::sync::Arc::new(" };
                            match t0().map(|t| t.kind()) {
                                Some(ty::Slice(_)) | Some(ty::Str) | None => manual(format!("{name} of unsized")),
                                Some(_) => wrap(p, self.init_tree(t0().unwrap(), depth + 1, site), ")"),
                            }
                        }
                        "PhantomData" => lit("core::marker::PhantomData"),
                        "Cell" => wrap("core::cell::Cell::new(", self.init_tree(t0().unwrap(), depth + 1, site), ")"),
                        "RefCell" => wrap("core::cell::RefCell::new(", self.init_tree(t0().unwrap(), depth + 1, site), ")"),
                        "UnsafeCell" => {
                            wrap("core::cell::UnsafeCell::new(", self.init_tree(t0().unwrap(), depth + 1, site), ")")
                        }
                        "SyncUnsafeCell" => {
                            wrap("core::cell::SyncUnsafeCell::new(", self.init_tree(t0().unwrap(), depth + 1, site), ")")
                        }
                        "OnceCell" => lit("core::cell::OnceCell::new()"),
                        "OnceLock" => lit("std::sync::OnceLock::new()"),
                        "ManuallyDrop" => {
                            wrap("core::mem::ManuallyDrop::new(", self.init_tree(t0().unwrap(), depth + 1, site), ")")
                        }
                        "Wrapping" => wrap("core::num::Wrapping(", self.init_tree(t0().unwrap(), depth + 1, site), ")"),
                        "Reverse" => wrap("core::cmp::Reverse(", self.init_tree(t0().unwrap(), depth + 1, site), ")"),
                        "Duration" => lit("core::time::Duration::ZERO"),
                        "VecDeque" => lit("std::collections::VecDeque::new()"),
                        "BTreeMap" => lit("std::collections::BTreeMap::new()"),
                        "BTreeSet" => lit("std::collections::BTreeSet::new()"),
                        "BinaryHeap" => lit("std::collections::BinaryHeap::new()"),
                        "PathBuf" => lit("std::path::PathBuf::new()"),
                        "OsString" => lit("std::ffi::OsString::new()"),
                        "AtomicBool" => lit("core::sync::atomic::AtomicBool::new(false)"),
                        "AtomicPtr" => lit("core::sync::atomic::AtomicPtr::new(core::ptr::null_mut())"),
                        "Atomic" => manual(format!("generic Atomic {}", self.ty_str(ty))),
                        n if n.starts_with("Atomic") => lit(&format!("core::sync::atomic::{n}::new(0)")),
                        "BuildHasherDefault" => lit("core::hash::BuildHasherDefault::new()"),
                        _ => {
                            let mut o = J::obj();
                            o.set("k", J::Str("extern".into()));
                            o.set("krate", J::Str(krate.to_string()));
                            o.set("name", J::Str(name.to_string()));
                            o.set("printed", J::Str(with_crate_prefix!(with_no_trimmed_paths!(tcx.def_path_str(did)))));
                            o.set("ty", J::Str(self.ty_str(ty)));
                            let targs: Vec<J> = args.types().map(|t| self.init_tree(t, depth + 1, site)).collect();
                            o.set("targs", J::Arr(targs));
                            o
                        }
                    };
                }
                let mut o = J::obj();
                o.set("k", J::Str("extern".into()));
                o.set("krate", J::Str(krate.to_string()));
                o.set("name", J::Str(name.to_string()));
                o.set("printed", J::Str(with_crate_prefix!(with_no_trimmed_paths!(tcx.def_path_str(did)))));
                o.set("ty", J::Str(self.ty_str(ty)));
                let targs: Vec<J> = args.types().map(|t| self.init_tree(t, depth + 1, site)).collect();
                o.set("targs", J::Arr(targs));
                o
            }
            ty::Param(p) => manual(format!("type param {}", p.name)),
            _ => manual(format!("kind {}", self.ty_str(ty))),
        }
    }

    fn emit(&mut self, j: J) {
        self.out.push(j.to_string());
    }
}

fn analyze(tcx: TyCtxt<'_>) {
    let Some(default_trait) = tcx.get_diagnostic_item(sym::Default) else { return };
    let default_fn = tcx.get_diagnostic_item(sym::default_fn);
    let root = std::env::var("ORACLE_ROOT").unwrap_or_else(|_| "/workspace/bun".into());
    let krate = tcx.crate_name(LOCAL_CRATE).to_string();
    let mut cx = Cx { tcx, default_trait, default_fn, root, krate: krate.clone(), out: Vec::new(), scopes: RefCell::new(HashMap::new()), ws_crates: RefCell::new(HashMap::new()) };

    // only workspace crates: the crate root file must be a workspace file
    let root_span = tcx.def_span(LOCAL_CRATE.as_def_id());
    let root_file = cx.file_of(root_span);
    if !cx.is_workspace_file(&root_file) {
        return;
    }

    let mut derived_impl_fns: HashSet<LocalDefId> = HashSet::new();
    let mut manual_impl_fns: Vec<(LocalDefId, DefId)> = Vec::new();

    // ---- impls of Default in this crate
    let impls: Vec<LocalDefId> = tcx.all_local_trait_impls(()).get(&default_trait).cloned().unwrap_or_default();
    for impl_did in impls {
        let derived = tcx.is_automatically_derived(impl_did.to_def_id());
        let self_ty = tcx.type_of(impl_did).instantiate_identity().skip_normalization();
        let mut rec = J::obj();
        rec.set("rec", J::Str("impl".into()));
        rec.set("crate", J::Str(krate.clone()));
        rec.set("derived", J::Bool(derived));
        rec.set("self_ty", J::Str(cx.ty_str(self_ty)));
        let item = tcx.hir_expect_item(impl_did);
        rec.set("impl_span", cx.span_json(item.span));
        let generics = tcx.generics_of(impl_did);
        let n_ty_params = generics
            .own_params
            .iter()
            .filter(|p| matches!(p.kind, ty::GenericParamDefKind::Type { .. } | ty::GenericParamDefKind::Const { .. }))
            .count();
        rec.set("n_ty_params", J::Num(n_ty_params as i64));
        // does the impl itself require `X: Default` of something?
        let preds = tcx.clauses_of(impl_did).instantiate_identity(tcx);
        let mut bound_on: Vec<J> = Vec::new();
        for (clause, _) in preds {
            if let Some(tp) = clause.skip_normalization().as_trait_clause() {
                if tp.def_id() == default_trait {
                    bound_on.push(J::Str(cx.ty_str(tp.self_ty().skip_binder())));
                }
            }
        }
        rec.set("default_bounds", J::Arr(bound_on));

        let mut fn_did: Option<LocalDefId> = None;
        for ai in tcx.associated_items(impl_did.to_def_id()).in_definition_order() {
            if ai.name().as_str() == "default" {
                if let Some(l) = ai.def_id.as_local() {
                    fn_did = Some(l);
                }
            }
        }

        if let ty::Adt(def, _) = self_ty.kind() {
            let adt_did = def.did();
            let mut adt = cx.adt_key(adt_did);
            adt.set(
                "kind",
                J::Str(if def.is_enum() { "enum" } else if def.is_union() { "union" } else { "struct" }.into()),
            );
            adt.set("workspace", J::Bool(cx.is_workspace_def(adt_did)));
            if let Some(local) = adt_did.as_local() {
                let aitem = tcx.hir_expect_item(local);
                adt.set("item_span", cx.span_json(aitem.span));
                adt.set("vis", J::Str(cx.snippet(aitem.vis_span)));
                adt.set("def_span", cx.span_json(tcx.def_span(adt_did)));
                if let Some(g) = tcx.hir_get_generics(local) {
                    adt.set("generics", J::Str(cx.snippet(g.span)));
                    adt.set("where", J::Str(cx.snippet(g.where_clause_span)));
                    let mut params = Vec::new();
                    for p in g.params {
                        let mut po = J::obj();
                        po.set("name", J::Str(p.name.ident().to_string()));
                        po.set(
                            "kind",
                            J::Str(
                                match p.kind {
                                    hir::GenericParamKind::Lifetime { .. } => "lifetime",
                                    hir::GenericParamKind::Type { .. } => "type",
                                    hir::GenericParamKind::Const { .. } => "const",
                                }
                                .into(),
                            ),
                        );
                        po.set("text", J::Str(cx.snippet(p.span)));
                        params.push(po);
                    }
                    adt.set("params", J::Arr(params));
                }
                let mut names = Vec::new();
                for inh in tcx.inherent_impls(adt_did).iter() {
                    for ai in tcx.associated_items(*inh).in_definition_order() {
                        let mut n = J::obj();
                        n.set("name", J::Str(ai.name().to_string()));
                        let kind = match ai.kind {
                            ty::AssocKind::Const { .. } => "const".to_string(),
                            ty::AssocKind::Fn { .. } => {
                                let sig = tcx.fn_sig(ai.def_id).instantiate_identity().skip_binder();
                                format!("fn/{}", sig.inputs().len())
                            }
                            ty::AssocKind::Type { .. } => "type".to_string(),
                        };
                        n.set("kind", J::Str(kind));
                        n.set("vis", J::Str(format!("{:?}", tcx.visibility(ai.def_id))));
                        names.push(n);
                    }
                }
                adt.set("inherent", J::Arr(names));
            }
            rec.set("adt", adt);

            if derived {
                let espan = item.span;
                if espan.from_expansion() {
                    let cs = espan.ctxt().outer_expn_data().call_site;
                    rec.set("derive_span", cx.span_json(cs));
                }
                if let Some(f) = fn_did {
                    derived_impl_fns.insert(f);
                }
                if def.is_enum() {
                    // the derived body is `Self::Variant`
                    if let Some(f) = fn_did {
                        let body = tcx.hir_body_owned_by(f);
                        let mut e = body.value;
                        while let hir::ExprKind::Block(b, _) = e.kind {
                            if let Some(t) = b.expr {
                                e = t
                            } else {
                                break;
                            }
                        }
                        if let hir::ExprKind::Path(ref qp) = e.kind {
                            let res = tcx.typeck(f).qpath_res(qp, e.hir_id);
                            if let Res::Def(DefKind::Ctor(CtorOf::Variant, _), ctor) = res {
                                let variant = tcx.parent(ctor);
                                rec.set("default_variant", J::Str(tcx.item_name(variant).to_string()));
                            }
                        }
                    }
                } else if adt_did.is_local() {
                    let variant = def.non_enum_variant();
                    let mut fields = Vec::new();
                    rec.set("ctor_kind", J::Str(format!("{:?}", variant.ctor_kind())));
                    for fd in variant.fields.iter() {
                        let mut fo = J::obj();
                        fo.set("name", J::Str(fd.name.to_string()));
                        let fty = tcx.type_of(fd.did).instantiate_identity().skip_normalization();
                        fo.set("ty", J::Str(cx.ty_str(fty)));
                        if let Some(fl) = fd.did.as_local() {
                            if let hir::Node::Field(hf) = tcx.hir_node_by_def_id(fl) {
                                fo.set("ty_text", J::Str(cx.snippet(hf.ty.span)));
                                fo.set("ty_span", cx.span_json(hf.ty.span));
                            }
                        }
                        let site = Site { module: tcx.parent_module_from_def_id(adt_did.expect_local()), def: adt_did.expect_local() };
                        fo.set("init", cx.init_tree(fty, 0, site));
                        fields.push(fo);
                    }
                    rec.set("fields", J::Arr(fields));
                }
            } else if let Some(f) = fn_did {
                manual_impl_fns.push((f, adt_did));
                let body = tcx.hir_body_owned_by(f);
                let fnode = tcx.hir_node_by_def_id(f);
                let mut m = J::obj();
                if let hir::Node::ImplItem(ii) = fnode {
                    m.set("fn_span", cx.span_json(ii.span));
                }
                m.set("body_span", cx.span_json(body.value.span));
                m.set("body_text", J::Str(cx.snippet(body.value.span)));
                // delegation?
                let mut e = body.value;
                loop {
                    match e.kind {
                        hir::ExprKind::Block(b, _) if b.stmts.is_empty() && b.expr.is_some() => e = b.expr.unwrap(),
                        _ => break,
                    }
                }
                let typeck = tcx.typeck(f);
                match e.kind {
                    hir::ExprKind::Path(ref qp) => {
                        let res = typeck.qpath_res(qp, e.hir_id);
                        let kind = match res {
                            Res::Def(DefKind::AssocConst { .. }, _) => Some("assoc-const"),
                            Res::Def(DefKind::Const { .. }, _) => Some("const"),
                            Res::Def(DefKind::Ctor(CtorOf::Variant, hir::def::CtorKind::Const), _) => {
                                Some("unit-variant")
                            }
                            Res::Def(DefKind::Ctor(CtorOf::Struct, hir::def::CtorKind::Const), _) => Some("unit-struct"),
                            Res::SelfCtor(_) => Some("unit-struct"),
                            _ => None,
                        };
                        if let Some(k) = kind {
                            m.set("delegate", J::Str(cx.snippet(e.span)));
                            m.set("delegate_kind", J::Str(k.into()));
                        }
                    }
                    hir::ExprKind::Call(callee, cargs) if cargs.is_empty() => {
                        if let hir::ExprKind::Path(ref qp) = callee.kind {
                            let res = typeck.qpath_res(qp, callee.hir_id);
                            if let Res::Def(DefKind::AssocFn, fdid) = res {
                                let parent = tcx.parent(fdid);
                                if tcx.def_kind(parent) == (DefKind::Impl { of_trait: false }) {
                                    let pty = tcx.type_of(parent).instantiate_identity().skip_normalization();
                                    if let ty::Adt(pd, _) = pty.kind() {
                                        if pd.did() == adt_did {
                                            m.set("delegate", J::Str(cx.snippet(e.span)));
                                            m.set("delegate_kind", J::Str("inherent-fn".into()));
                                            m.set("delegate_fn", J::Str(tcx.item_name(fdid).to_string()));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
                rec.set("manual", m);
            }
        } else {
            if derived {
                if let Some(f) = fn_did {
                    derived_impl_fns.insert(f);
                }
            }
            rec.set("non_adt", J::Bool(true));
        }
        cx.emit(rec);
    }

    // ---- bodies
    let owners: Vec<LocalDefId> = tcx.hir_body_owners().collect();
    for owner in owners {
        if derived_impl_fns.contains(&owner) {
            continue;
        }
        // anything inside an automatically derived impl is generated code
        let mut p = owner.to_def_id();
        let mut in_derived = false;
        loop {
            if matches!(tcx.def_kind(p), DefKind::Impl { .. }) {
                in_derived = tcx.is_automatically_derived(p);
                break;
            }
            match tcx.opt_parent(p) {
                Some(pp) => p = pp,
                None => break,
            }
        }
        if in_derived {
            continue;
        }
        let typeck_root = tcx.typeck_root_def_id(owner.to_def_id());
        let owner_impl_adt = manual_impl_fns.iter().find(|(f, _)| f.to_def_id() == typeck_root).map(|(_, a)| *a);
        let body = tcx.hir_body_owned_by(owner);
        let typeck = tcx.typeck(owner);
        let mut v = BodyVisitor { cx: &mut cx, typeck, owner, owner_impl_adt, handled: HashSet::new() };
        v.visit_expr(body.value);
    }

    // ---- write
    if cx.out.is_empty() {
        return;
    }
    let dir = std::env::var("ORACLE_OUT").unwrap_or_else(|_| "/tmp/oracle-out".into());
    let _ = std::fs::create_dir_all(&dir);
    let crate_types = format!("{:?}", tcx.crate_types());
    let is_test = tcx.sess.opts.test;
    let stable_id = format!("{:x}", tcx.stable_crate_id(LOCAL_CRATE).as_u64());
    let target = tcx.sess.opts.target_triple.to_string();
    let path = format!("{dir}/{krate}-{target}-{}{stable_id}.jsonl", if is_test { "test-" } else { "" });
    let mut f = std::fs::File::create(&path).unwrap();
    let mut header = J::obj();
    header.set("rec", J::Str("crate".into()));
    header.set("crate", J::Str(krate));
    header.set("crate_types", J::Str(crate_types));
    header.set("test", J::Bool(is_test));
    header.set("target", J::Str(target));
    header.set("root_file", J::Str(cx.rel(&root_file)));
    writeln!(f, "{}", header.to_string()).unwrap();
    for l in &cx.out {
        writeln!(f, "{l}").unwrap();
    }
}

struct BodyVisitor<'a, 'tcx> {
    cx: &'a mut Cx<'tcx>,
    typeck: &'tcx ty::TypeckResults<'tcx>,
    owner: LocalDefId,
    owner_impl_adt: Option<DefId>,
    handled: HashSet<hir::HirId>,
}

impl<'a, 'tcx> BodyVisitor<'a, 'tcx> {
    fn base_rec(&self, rec_kind: &str, span: Span) -> J {
        let tcx = self.cx.tcx;
        let mut rec = J::obj();
        rec.set("rec", J::Str(rec_kind.into()));
        rec.set("crate", J::Str(self.cx.krate.clone()));
        rec.set("span", self.cx.span_json(span));
        rec.set("owner", J::Str(with_no_trimmed_paths!(tcx.def_path_str(self.owner.to_def_id()))));
        if let Some(a) = self.owner_impl_adt {
            rec.set("owner_default_impl_of", self.cx.adt_key(a));
        }
        rec
    }

    /// `callee` is a path expression. Returns true when it resolves to `Default::default`.
    fn is_default_path(&self, callee: &hir::Expr<'tcx>) -> bool {
        if let hir::ExprKind::Path(ref qp) = callee.kind {
            if let Res::Def(_, did) = self.typeck.qpath_res(qp, callee.hir_id) {
                return Some(did) == self.cx.default_fn;
            }
        }
        false
    }

    fn record_default(
        &mut self,
        call: Option<&'tcx hir::Expr<'tcx>>,
        callee: &'tcx hir::Expr<'tcx>,
        update: Option<J>,
    ) {
        let hir::ExprKind::Path(ref qp) = callee.kind else { return };
        let whole = call.unwrap_or(callee);
        let mut rec = self.base_rec("call", whole.span);
        // the value type: for a call, the call's type. For a path used as a value, the fn's Self type.
        let ty = match call {
            Some(c) => self.typeck.expr_ty(c),
            None => {
                let fty = self.typeck.expr_ty(callee);
                match fty.kind() {
                    ty::FnDef(_, args) => args.skip_binder().type_at(0),
                    _ => fty,
                }
            }
        };
        rec.set("is_call", J::Bool(call.is_some()));
        rec.set("ty", J::Str(self.cx.ty_str(ty)));
        let site = Site { module: self.cx.tcx.parent_module(whole.hir_id), def: self.owner };
        rec.set("init", self.cx.init_tree(ty, 0, site));
        let ctx = match self.cx.tcx.parent_hir_node(whole.hir_id) {
            hir::Node::ExprField(_) => "field",
            hir::Node::LetStmt(l) if l.ty.is_some() => "let-typed",
            _ => "other",
        };
        rec.set("ctx", J::Str(ctx.into()));
        rec.set("callee_span", self.cx.span_json(callee.span));
        match qp {
            hir::QPath::Resolved(None, _) => {
                rec.set("form", J::Str("bare".into()));
            }
            hir::QPath::Resolved(Some(qself), _) => {
                rec.set("form", J::Str("qself".into()));
                rec.set("type_text", J::Str(self.cx.snippet(qself.span)));
                rec.set("type_span", self.cx.span_json(qself.span));
            }
            hir::QPath::TypeRelative(t, seg) => {
                rec.set("form", J::Str("typed".into()));
                rec.set("type_text", J::Str(self.cx.snippet(t.span)));
                rec.set("type_span", self.cx.span_json(t.span));
                rec.set("seg_span", self.cx.span_json(seg.ident.span));
                let is_self = matches!(t.kind, hir::TyKind::Path(hir::QPath::Resolved(None, p)) if matches!(p.res, Res::SelfTyAlias { .. } | Res::SelfTyParam { .. }));
                rec.set("type_is_self", J::Bool(is_self));
            }
        }
        if let Some(u) = update {
            rec.set("update", u);
        }
        self.cx.emit(rec);
    }

    /// Any callee whose instantiated predicates require `X: Default`.
    fn record_obligations(
        &mut self,
        ex: &'tcx hir::Expr<'tcx>,
        did: DefId,
        args: ty::GenericArgsRef<'tcx>,
        form: &str,
        extra: Option<(&str, J)>,
    ) {
        let tcx = self.cx.tcx;
        if Some(did) == self.cx.default_fn {
            return;
        }
        if !matches!(tcx.def_kind(did), DefKind::Fn | DefKind::AssocFn | DefKind::Ctor(..)) {
            return;
        }
        if tcx.generics_of(did).count() != args.len() {
            return;
        }
        let inst = tcx.clauses_of(did).instantiate(tcx, args);
        let mut selfs: Vec<Ty<'tcx>> = Vec::new();
        for (clause, _) in inst {
            if let Some(tp) = clause.skip_normalization().as_trait_clause() {
                if tp.def_id() == self.cx.default_trait {
                    selfs.push(tp.self_ty().skip_binder());
                }
            }
        }
        for st in selfs {
            let mut rec = self.base_rec("oblig", ex.span);
            rec.set("form", J::Str(form.into()));
            rec.set("callee", J::Str(with_no_trimmed_paths!(tcx.def_path_str(did))));
            rec.set("callee_name", J::Str(tcx.item_name(did).to_string()));
            rec.set("callee_workspace", J::Bool(self.cx.is_workspace_def(did)));
            rec.set("ty", J::Str(self.cx.ty_str(st)));
            let site = Site { module: tcx.parent_module(ex.hir_id), def: self.owner };
            rec.set("init", self.cx.init_tree(st, 0, site));
            if let Some((k, ref v)) = extra {
                rec.set(k, v.clone());
            }
            self.cx.emit(rec);
        }
    }
}

impl<'a, 'tcx> Visitor<'tcx> for BodyVisitor<'a, 'tcx> {
    fn visit_expr(&mut self, ex: &'tcx hir::Expr<'tcx>) {
        match ex.kind {
            hir::ExprKind::Struct(qpath, fields, hir::StructTailExpr::Base(base)) => {
                if let hir::ExprKind::Call(callee, cargs) = base.kind {
                    if cargs.is_empty() && self.is_default_path(callee) {
                        let mut u = J::obj();
                        u.set("struct_path_text", J::Str(self.cx.snippet(qpath.span())));
                        u.set("struct_path_span", self.cx.span_json(qpath.span()));
                        u.set("struct_span", self.cx.span_json(ex.span));
                        let set: Vec<String> = fields.iter().map(|f| f.ident.to_string()).collect();
                        let sty = self.typeck.expr_ty(ex);
                        let mut missing = Vec::new();
                        if let ty::Adt(def, _) = sty.kind() {
                            if def.is_struct() {
                                for fd in def.non_enum_variant().fields.iter() {
                                    let n = fd.name.to_string();
                                    if !set.contains(&n) {
                                        missing.push(J::Str(n));
                                    }
                                }
                            }
                        }
                        u.set("set", J::Arr(set.into_iter().map(J::Str).collect()));
                        u.set("missing", J::Arr(missing));
                        self.handled.insert(base.hir_id);
                        self.handled.insert(callee.hir_id);
                        self.record_default(Some(base), callee, Some(u));
                    }
                }
            }
            hir::ExprKind::Call(callee, cargs) => {
                if let hir::ExprKind::Path(ref qp) = callee.kind {
                    if !self.handled.contains(&ex.hir_id) {
                        if cargs.is_empty() && self.is_default_path(callee) {
                            self.handled.insert(callee.hir_id);
                            self.record_default(Some(ex), callee, None);
                        } else if let Res::Def(_, did) = self.typeck.qpath_res(qp, callee.hir_id) {
                            self.handled.insert(callee.hir_id);
                            let args = self.typeck.node_args(callee.hir_id);
                            let mut arg_spans = Vec::new();
                            for a in cargs {
                                arg_spans.push(self.cx.span_json(a.span));
                            }
                            let mut extra = J::obj();
                            extra.set("args", J::Arr(arg_spans));
                            extra.set("callee_span", self.cx.span_json(callee.span));
                            self.record_obligations(ex, did, args, "call", Some(("call", extra)));
                        }
                    }
                }
            }
            hir::ExprKind::MethodCall(seg, recv, margs, _) => {
                if let Some(did) = self.typeck.type_dependent_def_id(ex.hir_id) {
                    let args = self.typeck.node_args(ex.hir_id);
                    let mut extra = J::obj();
                    extra.set("method_span", self.cx.span_json(seg.ident.span));
                    extra.set("recv_span", self.cx.span_json(recv.span));
                    extra.set("n_args", J::Num(margs.len() as i64));
                    extra.set("recv_ty", J::Str(self.cx.ty_str(self.typeck.expr_ty(recv))));
                    self.record_obligations(ex, did, args, "method", Some(("method", extra)));
                }
            }
            hir::ExprKind::Path(ref qp) => {
                if !self.handled.contains(&ex.hir_id) {
                    if let Res::Def(_, did) = self.typeck.qpath_res(qp, ex.hir_id) {
                        if Some(did) == self.cx.default_fn {
                            self.record_default(None, ex, None);
                        } else {
                            let args = self.typeck.node_args(ex.hir_id);
                            self.record_obligations(ex, did, args, "path", None);
                        }
                    }
                }
            }
            _ => {}
        }
        intravisit::walk_expr(self, ex);
    }
}
