//! Modules, namespaces, imports and exports that are out of place, lead nowhere or do not go with the options:
//!
//! * `bindModuleDeclaration`: 2668 5061; `bindNamespaceExportDeclaration`: 1184 1314 1315 1316
//! * `checkModuleDeclaration`: 1035 1280 1287 1540 2435 2436 2669 2670; `checkModuleAugmentationElement`: 2666 2667
//! * `mergeModuleAugmentation`, and what `resolveExternalModule` and `mergeSymbol` say on its behalf: 2306 2567 2649 2664 2665 2671 2732 2834 2835
//! * `checkExternalImportOrExportDeclaration`: 1147 1194 2439 2858
//! * `collectModuleReferences`, by way of `resolveExternalModule`: 2307 2580 2591 2732 2882, said or taken back
//! * `checkImportAttributes`, `getTypeFromImportAttributes`, `checkImportType`, `getResolutionModeOverride`: 1453 1454 1463 1464 2322
//!   2823 2856 2857
//! * `checkImportEqualsDeclaration`: 2437 2438; `checkExportDeclaration`: 1193 1194 2498; `checkClassDeclaration`: 1211
//! * `checkExportAssignment`: 1063 1120 1319 1282 1283 1284 1285 1289 1290 1291 1292
//! * `getVerbatimModuleSyntaxErrorMessage`, from `checkAliasSymbol`, `checkExportAssignment` and `checkGrammarImportCallExpression`: 1286 1295
//! * `checkGrammarModifiers`, of `export`: 1287, of `default`: 1319; `reportObviousModifierErrors`: 1184
//! * `checkGrammarModuleElementContext`: 1231 1232 1233 1234 1235 1258 1473 1474
//! * `getTypeFromImportTypeNode`: 1339 1340; `checkGrammarImportClause`: 18060
//! * `reportFlowControlError`: 2563
//!
//! All of TypeScript 7.0.2's checker.go, flow.go, grammarchecks.go, binder.go and parser/references.go. Only
//! `check_import_attribute_types` and `check_flow_too_deep` ask for types.
//!
//! The summary of a file keeps neither modifiers nor keywords: they are read from the text, from a place the summary does have. The
//! attributes of import types are read from the text too. Those of declarations are in `hir::File::import_attributes`.
//! Of a declaration file there is no text, and what can only be read is not looked for.

use super::errors::Diagnostic;
use super::*;
use crate::bind::{Decl, MemberOwner, Parent, ScopeId, ScopeKind};
use crate::resolve::ModuleKind;

/// The words `is_modifier` knows, as the summary has them.
const MODIFIERS: Flags = Flags::EXPORT
    .union(Flags::DEFAULT)
    .union(Flags::AMBIENT)
    .union(Flags::ABSTRACT)
    .union(Flags::ASYNC)
    .union(Flags::STATIC)
    .union(Flags::READONLY)
    .union(Flags::PRIVATE)
    .union(Flags::PROTECTED)
    .union(Flags::PUBLIC)
    .union(Flags::OVERRIDE)
    .union(Flags::ACCESSOR);

/// What is the same all over a file.
struct Cx<'a> {
    file: FileId,
    text: &'a [u8],
    /// Where module specifiers are written, in the order of the text.
    uses: &'a [SpecifierUse],
    /// What `attributes_keyword` was last asked, and what it said.
    last_keyword: std::cell::Cell<(u32, bool, Option<(usize, usize)>)>,
    /// `IsExternalModule`, as the program has it.
    is_module: bool,
    /// The program has it for a script, and it may be a module all the same: `xm_may_be_module`. What depends on which it is is
    /// not said.
    may_be_module: bool,
    /// Not `hasParseDiagnostics`: what `grammarErrorOnNode` has to say is only said of a file that parses.
    grammar: bool,
    /// `IsInJSFile`
    is_js: bool,
    /// `verbatimModuleSyntax`
    is_verbatim: bool,
    /// `verbatimModuleSyntax`, in a file `GetEmitModuleFormatOfFile` has for CommonJS.
    verbatim_commonjs: bool,
    /// `getVerbatimModuleSyntaxErrorMessage`
    esm_syntax_code: u32,
    /// The start, the end and the type (`getTypeFromImportAttributes`) of the attributes of each import or export declaration. The
    /// `&self` passes collect them, and `check_import_attribute_types` relates them, which needs `&mut self`.
    attribute_types: std::cell::RefCell<Vec<(u32, u32, AttributesType)>>,
    /// The imported names that are no export of their module, and the specifier `esm_syntax_code` is said of if they stand for
    /// something after all. `check_members_of_export_equals` asks the type of the `export =` value, which needs `&mut self`.
    members_of_export_equals: std::cell::RefCell<Vec<(Sym, ImportSpecId)>>,
    /// The start and the code of each error whose message names a symbol, and the symbol. Printing it needs `&mut self`.
    named_symbols: std::cell::RefCell<Vec<(u32, u32, Sym)>>,
}

/// What `getTypeFromImportAttributes` is computed from.
#[derive(Copy, Clone)]
enum AttributesType {
    /// The attributes as the parser kept them: an `ExprKind::Object` of `hir::File::import_attributes`.
    Object(ExprId),
    /// The type, for attributes that were read from the text.
    Known(TypeId),
}

/// What a list of statements is the body of.
#[derive(Copy, Clone)]
struct Around {
    /// `NONE`: the file.
    module: ModuleId,
    /// `IsAmbientModule`
    is_ambient_module: bool,
    /// `IsExternalModuleAugmentation`
    is_augmentation: bool,
    /// The module is written at the top of the file.
    is_top_level: bool,
    /// `NodeFlagsAmbient`
    is_ambient: bool,
}

/// The lists of statements around a statement, from the inside out.
struct Lists<'a> {
    list: IdList<StmtId>,
    /// Not the `B` that is all there is in the `A` of `namespace A.B`.
    is_block: bool,
    outer: Option<&'a Lists<'a>>,
}

impl Cx<'_> {
    /// The module specifier of the statement at `pos`, which says `spec`.
    fn specifier(&self, pos: u32, spec: Atom) -> Option<SpecifierUse> {
        let at = self.uses.partition_point(|u| u.pos < pos);
        self.uses.get(at).copied().filter(|u| u.spec == spec)
    }

    /// `attributes_keyword`. A statement is asked about more than once.
    fn attributes_keyword(&self, spec_pos: u32, is_export: bool) -> Option<(usize, usize)> {
        let (last_pos, last_is_export, found) = self.last_keyword.get();
        if last_pos == spec_pos && last_is_export == is_export {
            return found;
        }
        let found = attributes_keyword(self.text, spec_pos, is_export);
        self.last_keyword.set((spec_pos, is_export, found));
        found
    }

    /// `checkGrammarModifiers`, of `export` on what is more than a type at the top of a file.
    fn export_modifier(&self, pos: u32, flags: Flags, around: Around, out: &mut Vec<Diagnostic>) {
        if self.verbatim_commonjs
            && self.grammar
            && around.module.is_none()
            && !around.is_ambient
            && flags.contains(Flags::EXPORT)
            && !flags.contains(Flags::AMBIENT)
            && let Some(start) =
                find_modifier(self.text, statement_start(self.text, pos), b"export")
        {
            out.push(Diagnostic { start, code: 1287 });
        }
    }

    /// `checkGrammarModifiers`, of `default` in a namespace.
    fn default_modifier(&self, pos: u32, flags: Flags, around: Around, out: &mut Vec<Diagnostic>) {
        if self.grammar
            && around.module.is_some()
            && !around.is_ambient_module
            && flags.contains(Flags::DEFAULT)
            && let Some(start) =
                find_modifier(self.text, statement_start(self.text, pos), b"default")
        {
            out.push(Diagnostic { start, code: 1319 });
        }
    }

    /// `checkExportAssignment` (1120), `checkExportDeclaration` (1193): the statement whose own `export` is at `pos` has modifiers.
    /// Reported at the first one, unless `checkGrammarModifiers` rejects them: it accepts `export`, `declare` and `export declare`.
    fn modifiers_before_export(
        &self,
        pos: u32,
        code: u32,
        around: Around,
        out: &mut Vec<Diagnostic>,
    ) {
        let start = statement_start(self.text, pos);
        if !self.grammar || start == pos || word_at(self.text, pos as usize) != b"export" {
            return;
        }
        let (mut at, mut has_export, mut has_declare) = (start as usize, false, false);
        while at < pos as usize {
            let word = word_at(self.text, at);
            match word {
                b"export" if !has_export && !has_declare => has_export = true,
                // 1038 in an ambient module block.
                b"declare" if !has_declare && !(around.is_ambient && around.module.is_some()) => {
                    has_declare = true
                }
                _ => return,
            }
            at = skip_trivia(self.text, at + word.len());
        }
        out.push(Diagnostic { start, code });
    }
}

impl Checker<'_> {
    pub(super) fn check_x_modules(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let hir = self.hir(file);
        if hir.kind == FileKind::Json {
            return;
        }
        self.check_flow_too_deep(file, out);
        let module = self.files().module(file);
        let path = module.path.as_str();
        let sorted;
        let uses: &[SpecifierUse] = if hir.specifier_uses.is_sorted_by_key(|u| u.pos) {
            &hir.specifier_uses
        } else {
            let mut uses = hir.specifier_uses.clone();
            uses.sort_unstable_by_key(|u| u.pos);
            sorted = uses;
            &sorted
        };
        // NEEDS: `Options::verbatim_module_syntax: bool`, what `compilerOptions.verbatimModuleSyntax` says
        let is_verbatim = self.p.files.options.verbatim_module_syntax;
        let cx = Cx {
            file,
            text: &hir.text,
            is_module: module.is_module(),
            may_be_module: self.xm_may_be_module(file),
            grammar: !has_parse_diagnostics(hir) && !has_import_assertions(&hir.text, uses),
            is_js: [".js", ".jsx", ".mjs", ".cjs"]
                .iter()
                .any(|e| path.ends_with(e)),
            is_verbatim,
            verbatim_commonjs: is_verbatim && self.xm_emits_commonjs(file),
            esm_syntax_code: if path.ends_with(".cts") || path.ends_with(".cjs") {
                1286
            } else {
                1295
            },
            attribute_types: Default::default(),
            members_of_export_equals: Default::default(),
            named_symbols: Default::default(),
            uses,
            last_keyword: std::cell::Cell::new((u32::MAX, false, None)),
        };
        let top = Around {
            module: ModuleId::NONE,
            is_ambient_module: false,
            is_augmentation: false,
            is_top_level: false,
            is_ambient: hir.kind == FileKind::Declaration,
        };
        self.xm_statements(
            &cx,
            &Lists {
                list: hir.body,
                is_block: true,
                outer: None,
            },
            top,
            false,
            out,
        );
        self.xm_statements_in_blocks(&cx, out);
        self.xm_static_blocks(&cx, out);
        self.xm_import_calls_and_types(&cx, out);
        self.check_import_attribute_types(&cx, out);
        self.check_members_of_export_equals(&cx, out);
        for (start, code, sym) in cx.named_symbols.take() {
            self.explain(start, code, |c| vec![c.symbol_to_string(sym)]);
        }
    }

    /// `reportFlowControlError`: reports 2563 at the first token of the function body, namespace body or file that contains a reference
    /// whose control flow walk reached the depth limit. `flow_type_of` records those references in `flows_too_deep`.
    fn check_flow_too_deep(&mut self, file: FileId, out: &mut Vec<Diagnostic>) {
        let (hir, bound) = (self.hir(file), self.bound(file));
        // The limit is 2000 levels, and a walk nests at most once per flow node.
        if bound.flow_places <= 2000 {
            return;
        }
        let mut reported = Parent::None;
        for i in 0..hir.exprs.len() {
            let e = ExprId(i as u32);
            if !matches!(hir[e].kind, ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::This)
                || matches!(bound.expr_parent[i], Parent::None)
                // `checkWithStatement` does not check the body.
                || hir.is_in_with(hir[e].pos)
            {
                continue;
            }
            // Ensures that the flow of `e` has been walked. The type is cached if an earlier pass asked for it.
            self.type_of_expr(file, e);
            if self.p.flows_too_deep.len() == 0 || self.p.flows_too_deep.get(&(file, e)).is_none() {
                continue;
            }
            // `FindAncestor(node, IsFunctionOrModuleBlock)`
            let mut block = bound.expr_parent[i];
            loop {
                block = match block {
                    // A static block is not function-like, and an expression body is not a block.
                    Parent::FnBody(f)
                        if hir[f].kind != FnKind::StaticBlock
                            && matches!(hir[f].body, FnBody::Block(_)) =>
                    {
                        break;
                    }
                    Parent::Module(_) | Parent::File | Parent::None => break,
                    Parent::Expr(x) if x.is_none() => Parent::None,
                    Parent::Key(object) if object.is_some() => Parent::Expr(object),
                    _ => self.outward(file, block),
                };
            }
            // Consecutive references usually share a block.
            if block == reported {
                continue;
            }
            // `GetRangeOfTokenAtPosition(sourceFile, block.StatementList().Pos())`
            let start = match block {
                Parent::File => Some(first_token_start(&hir.text)),
                Parent::Module(m) => statement_list_start(hir, hir[m].body),
                Parent::FnBody(f) => match hir[f].body {
                    FnBody::Block(statements) => statement_list_start(hir, statements),
                    _ => None,
                },
                _ => None,
            };
            if let Some(start) = start {
                reported = block;
                out.push(Diagnostic { start, code: 2563 });
                self.note(start, self.end_of_token_at(file, start), 2563, Vec::new());
            }
        }
    }

    /// Whether `file`, which the program has for a script, may be a module: `GetEmitModuleDetectionKind` makes one of every source
    /// file when `module` is one of Node's and `moduleDetection` is not said, `isFileForcedToBeModuleByFormat` of every one that is
    /// an ECMAScript module by its package.
    fn xm_may_be_module(&self, file: FileId) -> bool {
        let module = self.files().module(file);
        !module.is_module()
            && module.hir.kind != FileKind::Declaration
            && (self.p.files.options.module.is_node() || module.says_esm)
    }

    /// `GetEmitModuleFormatOfFile(file) == ModuleKindCommonJS`
    fn xm_emits_commonjs(&self, file: FileId) -> bool {
        // `GetImpliedNodeFormatForEmitWorker`
        match self.files().module(file).implied_format {
            ResolutionMode::Require => true,
            ResolutionMode::Import => false,
            ResolutionMode::None => self.p.files.options.module == ModuleKind::CommonJs,
        }
    }

    /// The statements of the file or of the body of a module. `says_module`: of `module A.B`, when this is what is in `A`.
    fn xm_statements(
        &self,
        cx: &Cx<'_>,
        lists: &Lists<'_>,
        around: Around,
        says_module: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let hir = self.hir(cx.file);
        for s in hir.ids(lists.list) {
            let pos = hir[s].pos;
            match hir[s].kind {
                StmtKind::Module(m) => self.xm_module(cx, lists, pos, m, around, says_module, out),
                StmtKind::Import(i) => self.xm_import(cx, pos, i, around, out),
                StmtKind::ImportEquals(i) => self.xm_import_equals(cx, pos, i, around, out),
                StmtKind::ExportNamed(x) => self.xm_export_named(cx, pos, x, around, out),
                StmtKind::ExportStar { spec, alias, .. } => {
                    self.xm_export_star(cx, pos, spec, alias, around, out)
                }
                StmtKind::ExportDefault(e) => {
                    self.xm_export_assignment(cx, pos, e, false, around, out)
                }
                StmtKind::ExportAssign(e) => {
                    self.xm_export_assignment(cx, pos, e, true, around, out)
                }
                StmtKind::Var(decls) => {
                    if let Some(d) = decls.iter().next() {
                        cx.export_modifier(pos, hir[d].flags, around, out);
                    }
                }
                StmtKind::Fn(f) => {
                    cx.export_modifier(pos, hir[f].flags, around, out);
                    cx.default_modifier(pos, hir[f].flags, around, out);
                }
                StmtKind::Class(c) => {
                    cx.export_modifier(pos, hir[c].flags, around, out);
                    cx.default_modifier(pos, hir[c].flags, around, out);
                }
                StmtKind::Interface(i) => cx.default_modifier(pos, hir[i].flags, around, out),
                StmtKind::Enum(e) => cx.export_modifier(pos, hir[e].flags, around, out),
                // `bindNamespaceExportDeclaration`: `export as namespace N` takes no modifiers, and belongs at the top of a declaration
                // file that is a module.
                StmtKind::ExportAsNamespace(_) => {
                    let start = statement_start(cx.text, pos);
                    if start != pos {
                        out.push(Diagnostic { start, code: 1184 });
                        self.note(start, self.end_of_stmt(cx.file, s), 1184, Vec::new());
                    }
                    let code = if around.module.is_some() {
                        1316
                    } else if cx.may_be_module {
                        // 1314 or 1315.
                        continue;
                    } else if !cx.is_module {
                        1314
                    } else if hir.kind != FileKind::Declaration {
                        1315
                    } else {
                        continue;
                    };
                    out.push(Diagnostic { start, code });
                    self.note(start, self.end_of_stmt(cx.file, s), code, Vec::new());
                }
                _ => {}
            }
        }
    }

    /// `node.End()` of the statement said to be at `pos`. 0 if there is none.
    fn xm_statement_end(&self, cx: &Cx<'_>, pos: u32) -> u32 {
        self.hir(cx.file)
            .stmts
            .iter()
            .position(|s| s.pos == pos)
            .map_or(0, |s| self.end_of_stmt(cx.file, StmtId(s as u32)))
    }

    // ───────────────────────────── module declarations ─────────────────────────────

    /// `bindModuleDeclaration`, `checkModuleDeclaration`
    fn xm_module(
        &self,
        cx: &Cx<'_>,
        lists: &Lists<'_>,
        pos: u32,
        m: ModuleId,
        around: Around,
        inherited: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, files) = (self.hir(cx.file), self.files());
        let module = hir[m];
        let name_pos = module.name_pos;
        let start = statement_start(cx.text, pos);
        let is_global = module.name == ModuleName::Global;
        let is_ambient_module = !matches!(module.name, ModuleName::Ident(_));
        let is_ambient = around.is_ambient || module.flags.contains(Flags::AMBIENT);
        let is_at_top = around.module.is_none();
        // `IsModuleAugmentationExternal`
        let adds_to_another = if is_at_top {
            cx.is_module
        } else {
            around.is_ambient_module && around.is_top_level && !cx.is_module
        };
        let is_augmentation = is_ambient_module && adds_to_another;
        let says_module = !is_ambient_module && says_module(cx.text, name_pos, inherited);

        let inner = Around {
            module: m,
            is_ambient_module,
            is_augmentation,
            is_top_level: is_at_top,
            is_ambient,
        };
        let body = Lists {
            list: module.body,
            is_block: !self.xm_is_dotted(cx, m),
            outer: Some(lists),
        };
        self.xm_statements(cx, &body, inner, says_module, out);

        if is_ambient_module {
            // The flag is also on what is written in an exported one: only the word counts.
            if module.flags.contains(Flags::EXPORT)
                && find_modifier(cx.text, start, b"export").is_some()
            {
                out.push(Diagnostic { start, code: 2668 });
            }
            // `TryParsePattern`
            if !is_augmentation
                && !cx.may_be_module
                && let ModuleName::String(name) = module.name
                && files
                    .atoms
                    .bytes(name)
                    .iter()
                    .filter(|&&c| c == b'*')
                    .count()
                    > 1
            {
                out.push(Diagnostic {
                    start: name_pos,
                    code: 5061,
                });
            }
        }

        if is_global
            && !around.is_ambient
            && !cx.text.is_empty()
            && find_modifier(cx.text, start, b"declare").is_none()
        {
            out.push(Diagnostic {
                start: name_pos,
                code: 2670,
            });
        }
        if cx.grammar && !is_ambient && matches!(module.name, ModuleName::String(_)) {
            out.push(Diagnostic {
                start: name_pos,
                code: 1035,
            });
        }
        if says_module {
            out.push(Diagnostic {
                start: name_pos,
                code: 1540,
            });
        }
        // Both are about options that keep `const enum`s, so that a namespace of nothing else counts as well.
        if !is_ambient
            && self.p.files.options.isolated_modules
            && self.xm_is_instantiated(cx, lists, m, &mut Vec::new())
        {
            if !cx.is_module && !cx.may_be_module {
                out.push(Diagnostic {
                    start: name_pos,
                    code: 1280,
                });
                self.note(
                    name_pos,
                    0,
                    1280,
                    vec![isolated_modules_like_flag_name(files)],
                );
            }
            if cx.verbatim_commonjs
                && is_at_top
                && module.flags.contains(Flags::EXPORT)
                && let Some(start) = find_modifier(cx.text, start, b"export")
            {
                out.push(Diagnostic { start, code: 1287 });
            }
        }

        // What is left tells a declaration from an addition, which is a matter of whether the file is a module.
        if !is_ambient_module || cx.may_be_module {
            return;
        }
        if is_augmentation {
            // What was not added to anything is not gone through: it would be one error after the other.
            let check_body = match module.name {
                ModuleName::String(name) => {
                    self.xm_merge_augmentation(cx, lists, m, name, around, out)
                }
                _ => true,
            };
            if check_body && cx.grammar {
                for s in hir.ids(module.body) {
                    // `checkModuleAugmentationElement`
                    let code = match hir[s].kind {
                        StmtKind::ExportAssign(_)
                        | StmtKind::ExportDefault(_)
                        | StmtKind::ExportNamed(_)
                        | StmtKind::ExportStar { .. } => 2666,
                        StmtKind::Import(_) => 2667,
                        StmtKind::ImportEquals(i)
                            if matches!(hir[i].target, ImportEqualsTarget::Require(_)) =>
                        {
                            2667
                        }
                        _ => continue,
                    };
                    out.push(Diagnostic {
                        start: statement_start(cx.text, hir[s].pos),
                        code,
                    });
                }
            }
        } else if is_global {
            out.push(Diagnostic {
                start: name_pos,
                code: 2669,
            });
        } else if !is_at_top {
            out.push(Diagnostic {
                start: name_pos,
                code: 2435,
            });
        } else if let ModuleName::String(name) = module.name
            && is_relative_name(files.atoms.bytes(name))
        {
            out.push(Diagnostic {
                start: name_pos,
                code: 2436,
            });
        }
    }

    /// Whether `m` is the `A` of `namespace A.B`.
    fn xm_is_dotted(&self, cx: &Cx<'_>, m: ModuleId) -> bool {
        let hir = self.hir(cx.file);
        let body = hir[m].body;
        body.len() == 1
            && matches!(hir[hir.id_at(body, 0)].kind, StmtKind::Module(inner) if follows_a_dot(cx.text, hir[inner].name_pos))
    }

    /// `mergeModuleAugmentation`: whether what `m` declares was added to the module called `name`. What is wrong with that is said
    /// of the first declaration in the file.
    fn xm_merge_augmentation(
        &self,
        cx: &Cx<'_>,
        lists: &Lists<'_>,
        m: ModuleId,
        name: Atom,
        around: Around,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let text = files.atoms.bytes(name);
        // `collectModuleReferences`: whether it is one of `ModuleAugmentations` at all.
        let is_collected = if around.module.is_none() {
            around.is_ambient || hir[m].flags.contains(Flags::AMBIENT)
        } else {
            around.is_ambient && !is_relative_name(text)
        };
        let symbol = bound.module_symbol[m.idx()];
        if !is_collected || symbol.is_none() {
            return false;
        }
        // All that goes by one quoted name in a file is one symbol here. `declareModuleSymbol` has one for each place they are in.
        let decls = &bound.symbols[symbol.idx()].decls;
        let is_here = |part: ModuleId| {
            hir.ids(lists.list)
                .any(|s| matches!(hir[s].kind, StmtKind::Module(x) if x == part))
        };
        let first = decls.iter().find_map(|&d| match d {
            Decl::Module(part) if is_here(part) => Some(part),
            _ => None,
        });
        let start = hir[m].name_pos;
        let mut report = |code: u32, of_each: bool| {
            if of_each || first == Some(m) {
                out.push(Diagnostic { start, code });
            }
        };
        let Some(found) = self.xm_module_of_specifier(cx.file, name) else {
            // `resolveExternalModule`. Names written where everything is only declared are not held against anybody.
            let (from, validates) = (files.module(cx.file), !around.is_ambient);
            if let Some(target) = from.imported_file(name) {
                if validates {
                    report(2306, false);
                    self.note(start, 0, 2306, vec![files.module(target).path.clone()]);
                }
            } else if from.is_untyped_import(name) {
                // With `allowJs` the JavaScript is a file of the program like any other.
                if !self.p.files.options.allow_js {
                    report(2665, false);
                    let at = from.untyped_imports.iter().position(|u| u.0 == name);
                    let path = from.untyped_import_files[at.unwrap()].0;
                    self.note(
                        start,
                        0,
                        2665,
                        vec![self.atom_text(name), self.atom_text(path)],
                    );
                }
            } else if validates {
                let code = if !self.p.files.options.resolve_json_module && text.ends_with(b".json")
                {
                    2732
                } else if let Some(&(_, is_there)) = from
                    .extensionless_imports
                    .iter()
                    .find(|e| from.is_esm && e.0 == name)
                {
                    if is_there { 2835 } else { 2834 }
                } else {
                    2664
                };
                report(code, false);
                let written = self.atom_text(name);
                match code {
                    2835 => {
                        if let Some(extension) =
                            suggested_import_extension(files, &from.path, &written)
                        {
                            self.note(start, 0, code, vec![written + extension]);
                        }
                    }
                    _ => self.note(start, 0, code, vec![written]),
                }
            }
            return false;
        };
        // What a file declares that may be a module after all may not be there to be added to.
        if !self.xm_is_a_file(found)
            && files
                .decls(found)
                .iter()
                .any(|&(of, _)| self.xm_may_be_module(of))
        {
            return false;
        }
        // `resolveExternalModuleSymbol`
        let main = files.module_value(found);
        let flags = files.flags(main);
        if !flags.intersects(SymFlags::NAMESPACE) {
            // An alias here is one that could not be followed.
            if !flags.contains(SymFlags::ALIAS) {
                report(2671, false);
            }
            return false;
        }
        // `mergeSymbol`, `SymbolFlagsValueModuleExcludes`: a module with values in it goes with neither a variable nor a `const enum`,
        // whatever else goes by the name.
        let is_variable = flags.intersects(SymFlags::VARIABLE);
        let is_const_enum = || {
            files.decls(main).iter().any(|&(of, d)| matches!(d, Decl::Enum(e) if files.hir(of)[e].flags.contains(Flags::CONST)))
        };
        let has_values = || {
            decls.iter().any(|&d| matches!(d, Decl::Module(part) if is_here(part) && self.xm_is_instantiated(cx, lists, part, &mut Vec::new())))
        };
        if (is_variable || flags.contains(SymFlags::ENUM) && is_const_enum()) && has_values() {
            if flags.contains(SymFlags::NAMESPACE_MODULE) {
                report(2649, false);
                cx.named_symbols.borrow_mut().push((start, 2649, main));
            } else if !is_variable {
                // `reportMergeSymbolError`, of the declarations on this side.
                report(2567, true);
            }
            return false;
        }
        true
    }

    fn xm_is_a_file(&self, module: Sym) -> bool {
        self.files().symbol(module).decls.contains(&Decl::File)
    }

    /// Whether a file that is no module declares the module `sym` at its top. Those are what `tryFindAmbientModule` and
    /// `patternAmbientModules` have.
    fn xm_is_declared_by_a_script(&self, sym: Sym) -> bool {
        let files = self.files();
        files.decls(sym).iter().any(|&(of, decl)| {
            let hir = files.hir(of);
            matches!(decl, Decl::Module(m)
                if !files.module(of).is_module() && hir.ids(hir.body).any(|s| matches!(hir[s].kind, StmtKind::Module(top) if top == m)))
        })
    }

    /// The module `spec` means in `file`, which is a file or what a script declares. A `declare module` that declares nothing to
    /// `resolveExternalModule` is not it, and does not stand in the way of a file either.
    fn xm_module_of_specifier(&self, file: FileId, spec: Atom) -> Option<Sym> {
        let files = self.files();
        let found = files.module_of_specifier(file, spec)?;
        if self.xm_is_a_file(found) || self.xm_is_declared_by_a_script(found) {
            return Some(found);
        }
        let target = files.module(file).imported_file(spec)?;
        files
            .module(target)
            .is_module()
            .then(|| files.file_symbol(target))
    }

    // ───────────────────────────── what a namespace comes to at run time ─────────────────────────────

    /// `GetModuleInstanceState(m) != ModuleInstanceStateNonInstantiated`. `lists`: what `m` is written in.
    /// `visited`: what has been asked, by statement or by body, and the answer once there is one.
    fn xm_is_instantiated(
        &self,
        cx: &Cx<'_>,
        lists: &Lists<'_>,
        m: ModuleId,
        visited: &mut Vec<(u32, Option<bool>)>,
    ) -> bool {
        let hir = self.hir(cx.file);
        let module = hir[m];
        if !module.has_body {
            return true;
        }
        // `getModuleInstanceStateCached`: what is being asked about counts for nothing meanwhile.
        let key = m.0 << 1 | 1;
        if let Some(&(_, state)) = visited.iter().find(|v| v.0 == key) {
            return state.unwrap_or(false);
        }
        let slot = visited.len();
        visited.push((key, None));
        let body = Lists {
            list: module.body,
            is_block: !self.xm_is_dotted(cx, m),
            outer: Some(lists),
        };
        let mut state = false;
        for s in hir.ids(module.body) {
            if self.xm_statement_is_instantiated(cx, &body, s, visited) {
                state = true;
                break;
            }
        }
        visited[slot].1 = Some(state);
        state
    }

    /// `getModuleInstanceStateWorker`
    fn xm_statement_is_instantiated(
        &self,
        cx: &Cx<'_>,
        lists: &Lists<'_>,
        s: StmtId,
        visited: &mut Vec<(u32, Option<bool>)>,
    ) -> bool {
        let hir = self.hir(cx.file);
        let key = s.0 << 1;
        if let Some(&(_, state)) = visited.iter().find(|v| v.0 == key) {
            return state.unwrap_or(false);
        }
        let slot = visited.len();
        visited.push((key, None));
        let state = match hir[s].kind {
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) | StmtKind::Import(_) => false,
            StmtKind::ImportEquals(i) => hir[i].flags.contains(Flags::EXPORT),
            StmtKind::ExportNamed(x) if hir[x].spec.is_none() => {
                let mut state = false;
                for spec in hir[x].items.iter() {
                    if self.xm_alias_target_is_instantiated(
                        cx,
                        lists,
                        hir[spec].local,
                        hir[spec].local_pos,
                        visited,
                    ) {
                        state = true;
                        break;
                    }
                }
                state
            }
            StmtKind::Module(inner) => self.xm_is_instantiated(cx, lists, inner, visited),
            _ => true,
        };
        visited[slot].1 = Some(state);
        state
    }

    /// `getModuleInstanceStateForAliasTarget`: of the `name` in `export { name }`.
    fn xm_alias_target_is_instantiated(
        &self,
        cx: &Cx<'_>,
        lists: &Lists<'_>,
        name: Atom,
        name_pos: u32,
        visited: &mut Vec<(u32, Option<bool>)>,
    ) -> bool {
        let hir = self.hir(cx.file);
        // `export { "x" }`
        if matches!(cx.text.get(name_pos as usize), Some(b'"' | b'\'')) {
            return true;
        }
        let mut at = Some(lists);
        while let Some(level) = at {
            at = level.outer;
            if !level.is_block {
                continue;
            }
            let mut is_declared = false;
            for s in hir.ids(level.list) {
                if !self.xm_has_name(cx.file, s, name) {
                    continue;
                }
                // What an import alias stands for cannot be told from here.
                if self.xm_statement_is_instantiated(cx, level, s, visited)
                    || matches!(hir[s].kind, StmtKind::ImportEquals(_))
                {
                    return true;
                }
                is_declared = true;
            }
            if is_declared {
                return false;
            }
        }
        true
    }

    /// `NodeHasName`
    fn xm_has_name(&self, file: FileId, s: StmtId, name: Atom) -> bool {
        let hir = self.hir(file);
        match hir[s].kind {
            StmtKind::Fn(f) => hir[f].name == name,
            StmtKind::Class(c) => hir[c].name == name,
            StmtKind::Interface(i) => hir[i].name == name,
            StmtKind::TypeAlias(a) => hir[a].name == name,
            StmtKind::Enum(e) => hir[e].name == name,
            StmtKind::ImportEquals(i) => hir[i].name == name,
            StmtKind::ExportAsNamespace(n) => n == name,
            StmtKind::Module(m) => match hir[m].name {
                ModuleName::Ident(n) => n == name,
                ModuleName::Global => name == known::global,
                ModuleName::String(_) => false,
            },
            StmtKind::Var(decls) => decls
                .iter()
                .any(|d| matches!(hir[hir[d].pat].kind, PatKind::Ident(n) if n == name)),
            _ => false,
        }
    }

    // ───────────────────────────── imports and exports ─────────────────────────────

    /// `checkExternalImportOrExportDeclaration`, of the statement at `pos` that names the module `spec`.
    fn xm_is_in_place(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        spec: Atom,
        is_export: bool,
        around: Around,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        // The specifier is missing or not a string literal. The parser has reported 1141.
        if spec.is_none() {
            return false;
        }
        let written = cx.specifier(pos, spec);
        if around.module.is_some() {
            if !around.is_ambient_module {
                if let Some(written) = written {
                    out.push(Diagnostic {
                        start: written.pos,
                        code: if is_export { 1194 } else { 1147 },
                    });
                }
                return false;
            }
            // `isTopLevelInExternalModuleAugmentation`: there it has been said that the statement has no business being there.
            if !around.is_augmentation
                && !cx.may_be_module
                && is_relative_name(self.files().atoms.bytes(spec))
            {
                let start = statement_start(cx.text, pos);
                out.push(Diagnostic { start, code: 2439 });
                self.note(start, self.xm_statement_end(cx, pos), 2439, Vec::new());
                return false;
            }
        }
        // The values of its attributes are strings. `import a = require("m")` has none.
        let mut are_strings = true;
        if let Some(written) = written
            && written.kind != SpecifierKind::Require
        {
            self.xm_attributes_after(cx, written.pos, is_export, |value, end| {
                are_strings = false;
                out.push(Diagnostic {
                    start: value,
                    code: 2858,
                });
                self.note(value, end, 2858, Vec::new());
            });
        }
        are_strings
    }

    /// `collectModuleReferences`: whether the module a statement directly in `around` calls `spec` is looked for on account of it.
    fn xm_is_collected(&self, cx: &Cx<'_>, spec: Atom, around: Around) -> bool {
        around.module.is_none()
            || !cx.is_module
                && around.is_top_level
                && around.is_ambient_module
                && around.is_ambient
                && !is_relative_name(self.files().atoms.bytes(spec))
    }

    /// Whether anything in the file has the module called `spec` looked for: `Imports` and `ModuleAugmentations`.
    fn xm_is_looked_for(&self, cx: &Cx<'_>, spec: Atom) -> bool {
        let hir = self.hir(cx.file);
        let is_relative = is_relative_name(self.files().atoms.bytes(spec));
        let names_it = |s: StmtId| match hir[s].kind {
            StmtKind::Import(i) => hir[i].spec == spec,
            StmtKind::ExportNamed(x) => hir[x].spec == spec,
            StmtKind::ExportStar { spec: named, .. } => named == spec,
            StmtKind::ImportEquals(i) => {
                matches!(hir[i].target, ImportEqualsTarget::Require(named) if named == spec)
            }
            _ => false,
        };
        let is_declaration_file = hir.kind == FileKind::Declaration;
        hir.ids(hir.body).any(|s| {
            let StmtKind::Module(m) = hir[s].kind else { return names_it(s) };
            let module = hir[m];
            if matches!(module.name, ModuleName::Ident(_)) || !(is_declaration_file || module.flags.contains(Flags::AMBIENT)) {
                return false;
            }
            if cx.is_module {
                return module.name == ModuleName::String(spec);
            }
            !is_relative
                && hir.ids(module.body).any(|inner| names_it(inner) || matches!(hir[inner].kind, StmtKind::Module(x) if hir[x].name == ModuleName::String(spec)))
        }) || hir.exprs.iter().any(|e| matches!(e.kind, ExprKind::ImportCall(a) if matches!(hir[a].kind, ExprKind::String(named) if named == spec)))
            || hir.types.iter().any(|t| matches!(t.kind, TypeNodeKind::Import { spec: named, .. } if named == spec))
    }

    /// Whether `resolveExternalModule` is at a loss for the module the statement at `pos` calls `spec`. It finds less than is found
    /// here: a file nothing has looked for is not there, and neither is a module that is only declared where that declares nothing.
    /// That is said, unless it has been.
    fn xm_module_is_missing(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        spec: Atom,
        is_collected: bool,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let (files, options) = (self.files(), &self.p.files.options);
        if cx.may_be_module {
            return false;
        }
        let is_found = match self.xm_module_of_specifier(cx.file, spec) {
            Some(found) => {
                !self.xm_is_a_file(found) || is_collected || self.xm_is_looked_for(cx, spec)
            }
            // What is not found here either has been reported.
            None if files.module_of_specifier(cx.file, spec).is_none() => return true,
            None => false,
        };
        if is_found {
            return false;
        }
        let Some(written) = cx.specifier(pos, spec) else {
            return true;
        };
        let is_side_effect = written.kind == SpecifierKind::SideEffect;
        if is_side_effect && !options.no_unchecked_side_effect_imports {
            return true;
        }
        let text = files.atoms.text(spec);
        let code = if !options.resolve_json_module && text.ends_with(".json") {
            2732
        } else if is_side_effect {
            2882
        } else if crate::resolve::is_node_core_module(&text) {
            // `getCannotResolveModuleNameErrorForSpecificModule`
            if options
                .types
                .as_ref()
                .is_some_and(|t| t.iter().any(|t| t == "*"))
            {
                2580
            } else {
                2591
            }
        } else {
            2307
        };
        out.push(Diagnostic {
            start: written.pos,
            code,
        });
        self.note(written.pos, 0, code, vec![self.atom_text(spec)]);
        true
    }

    /// What is left of a statement nothing is made of, be it that `checkExternalImportOrExportDeclaration` refuses it. Its module is
    /// looked for when something asks what a name it declares stands for (`resolveAlias`), and not otherwise.
    /// `may_be_used`: that cannot be told.
    fn xm_leave_alone(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        spec: Atom,
        is_used: bool,
        may_be_used: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        if is_used {
            self.xm_module_is_missing(cx, pos, spec, false, out);
        } else if !may_be_used && let Some(written) = cx.specifier(pos, spec) {
            // All that `resolveExternalModule` says of a specifier.
            out.retain(|d| {
                d.start != written.pos
                    || !matches!(
                        d.code,
                        1471 | 1479
                            | 1541
                            | 1542
                            | 2306
                            | 2307
                            | 2580
                            | 2591
                            | 2732
                            | 2834
                            | 2835
                            | 2846
                            | 2876
                            ..=2878 | 2882 | 5097 | 6137 | 6142 | 6263 | 7016
                    )
            });
        }
    }

    /// Whether the file mentions `alias`, which a statement directly in the module `m` declares, or at the top of the file.
    fn xm_alias_is_used(&self, cx: &Cx<'_>, m: ModuleId, alias: Atom) -> bool {
        let (hir, bound) = (self.hir(cx.file), self.bound(cx.file));
        let scope = if m.is_none() {
            bound.scopes.first()
        } else {
            bound.scopes.iter().find(|s| s.kind == ScopeKind::Module(m))
        };
        let Some(symbol) = scope.and_then(|s| bound.lookup(s.locals, alias)) else {
            return false;
        };
        let all = SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE;
        let means_it = |from: ScopeId, name: Atom| {
            name == alias && from.is_some() && bound.resolve(from, name, all) == Some(symbol)
        };
        bound.expr_symbol.iter().zip(&bound.expr_parent).any(|(&s, parent)| s == symbol && !matches!(parent, Parent::None))
            || hir.types.iter().enumerate().any(|(t, node)| match node.kind {
                TypeNodeKind::Ref { name, .. } | TypeNodeKind::Typeof { name, .. } => !name.is_empty() && means_it(bound.type_scope[t], hir.id_at(name, 0)),
                _ => false,
            })
            || hir.import_equals.iter().enumerate().any(|(other, import)| {
                matches!(import.target, ImportEqualsTarget::Entity(names) if !names.is_empty() && means_it(bound.import_equals_scope[other], hir.id_at(names, 0)))
            })
            || hir.exports.iter().enumerate().any(|(x, export)| export.spec.is_none() && export.items.iter().any(|s| means_it(bound.export_scope[x], hir[s].local)))
    }

    /// Whether the file has `name` after a dot, as it would be written of what a namespace exports: `N.name`.
    fn xm_follows_a_dot_somewhere(&self, cx: &Cx<'_>, name: Atom) -> bool {
        let hir = self.hir(cx.file);
        let is_among =
            |names: IdList<Atom>, from: usize| hir.ids(names).skip(from).any(|n| n == name);
        hir.exprs
            .iter()
            .any(|e| matches!(e.kind, ExprKind::Dot { name: member, .. } if member == name))
            || hir.types.iter().any(|t| match t.kind {
                TypeNodeKind::Ref { name: names, .. }
                | TypeNodeKind::Typeof { name: names, .. } => is_among(names, 1),
                TypeNodeKind::Import { name: names, .. } => is_among(names, 0),
                _ => false,
            })
            || hir.import_equals.iter().any(
                |i| matches!(i.target, ImportEqualsTarget::Entity(names) if is_among(names, 1)),
            )
    }

    /// `checkImportDeclaration`
    fn xm_import(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        i: ImportId,
        around: Around,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let import = hir[i];
        if self.xm_is_in_place(cx, pos, import.spec, false, around, out) {
            // `checkGrammarImportClause`, of `import defer * as ns`. A default name (18058) and named imports (18059) come first.
            let mut is_clause_refused = false;
            if cx.grammar
                && import.namespace.is_some()
                && import.default.is_none()
                && !import.type_only
                && !matches!(
                    self.p.files.options.module,
                    ModuleKind::EsNext | ModuleKind::Preserve
                )
            {
                let clause = skip_trivia(cx.text, word_end(cx.text, pos as usize));
                if word_at(cx.text, clause) == b"defer" {
                    is_clause_refused = true;
                    out.push(Diagnostic {
                        start: clause as u32,
                        code: 18060,
                    });
                    let end = self.end_of_name_at(cx.file, import.namespace_pos);
                    self.note(clause as u32, end, 18060, Vec::new());
                }
            }
            let is_missing = self.xm_module_is_missing(
                cx,
                pos,
                import.spec,
                self.xm_is_collected(cx, import.spec, around),
                out,
            );
            // `checkImportBinding`, `checkAliasSymbol`: of the names that stand for something.
            if !is_missing
                && !is_clause_refused
                && cx.verbatim_commonjs
                && !cx.is_js
                && around.module.is_none()
                && !around.is_ambient
                && !import.type_only
            {
                let locals = bound.scopes[0].locals;
                let is_resolved = |name: Atom| {
                    bound
                        .lookup(locals, name)
                        .is_some_and(|id| files.resolve_alias(files.sym(cx.file, id)).is_some())
                };
                if import.default.is_some() && is_resolved(import.default) {
                    out.push(Diagnostic {
                        start: import.default_pos,
                        code: cx.esm_syntax_code,
                    });
                    let end = cx
                        .specifier(pos, import.spec)
                        .map_or(0, |written| import_clause_end(cx.text, written.pos));
                    self.note(import.default_pos, end, cx.esm_syntax_code, Vec::new());
                }
                if import.namespace.is_some() && is_resolved(import.namespace) {
                    out.push(Diagnostic {
                        start: import.namespace_pos,
                        code: cx.esm_syntax_code,
                    });
                }
                for s in import.named.iter() {
                    if hir[s].type_only {
                        continue;
                    }
                    if is_resolved(hir[s].local) {
                        out.push(Diagnostic {
                            start: hir[s].imported_pos,
                            code: cx.esm_syntax_code,
                        });
                        self.note(
                            hir[s].imported_pos,
                            self.end_of_import_spec(cx.file, s),
                            cx.esm_syntax_code,
                            Vec::new(),
                        );
                    } else if let Some(id) = bound.lookup(locals, hir[s].local) {
                        cx.members_of_export_equals
                            .borrow_mut()
                            .push((files.sym(cx.file, id), s));
                    }
                }
            }
            // 1543: `isOnlyImportableAsDefault`, `hasTypeJsonImportAttribute`
            if !import.type_only
                && !is_clause_refused
                && (ModuleKind::Node18..=ModuleKind::NodeNext).contains(&files.options.module)
                && let Some(written) = cx.specifier(pos, import.spec)
                && written.kind != SpecifierKind::SideEffect
                && let Some(module) = files.module_of_specifier_as(
                    cx.file,
                    import.spec,
                    files.mode_of_import(cx.file, import.mode),
                )
                && files.is_only_importable_as_default(cx.file, module)
                && !self
                    .xm_attributes_after(cx, written.pos, false, |_, _| {})
                    .is_some_and(|(attributes, _)| {
                        attributes
                            .entries
                            .iter()
                            .any(|&(name, value)| name == b"type" && value == Some(&b"json"[..]))
                    })
            {
                out.push(Diagnostic {
                    start: written.pos,
                    code: 1543,
                });
                self.note(
                    written.pos,
                    0,
                    1543,
                    vec![module_kind_name(files.options.module).to_owned()],
                );
            }
        } else {
            let is_used = [import.default, import.namespace]
                .into_iter()
                .chain(import.named.iter().map(|s| hir[s].local))
                .any(|name| self.xm_alias_is_used(cx, around.module, name));
            self.xm_leave_alone(cx, pos, import.spec, is_used, false, out);
        }
        self.xm_import_attributes(cx, pos, import.spec, import.type_only, false, out);
    }

    /// `checkImportEqualsDeclaration`
    fn xm_import_equals(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        i: ImportEqualsId,
        around: Around,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let import = hir[i];
        cx.export_modifier(pos, import.flags, around, out);
        let names = match import.target {
            ImportEqualsTarget::Require(spec) => {
                if self.xm_is_in_place(cx, pos, spec, false, around, out) {
                    self.xm_module_is_missing(
                        cx,
                        pos,
                        spec,
                        self.xm_is_collected(cx, spec, around),
                        out,
                    );
                } else {
                    let is_used = self.xm_alias_is_used(cx, around.module, import.name);
                    let may_be_used = import.flags.contains(Flags::EXPORT)
                        && self.xm_follows_a_dot_somewhere(cx, import.name);
                    self.xm_leave_alone(cx, pos, spec, is_used, may_be_used, out);
                }
                return;
            }
            ImportEqualsTarget::Entity(names) => names,
        };
        let scope = bound.import_equals_scope[i.idx()];
        let mut path = [Atom::NONE; 8];
        if scope.is_none() || names.is_empty() || names.len() > path.len() {
            return;
        }
        for (slot, name) in path.iter_mut().zip(hir.ids(names)) {
            *slot = name;
        }
        let path = &path[..names.len()];
        // `getSymbolOfPartOfRightHandSideOfImportEquals`: a name on its own is the name of a namespace.
        let meaning = if path.len() == 1 {
            SymFlags::NAMESPACE
        } else {
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE
        };
        let Some(target) = files.resolve_entity(cx.file, scope, path, meaning) else {
            return;
        };
        let Some(flags) = self.xm_symbol_flags(target, false) else {
            return;
        };
        if flags.intersects(SymFlags::VALUE) {
            // As a value, the first name may mean something nearer by that is no namespace.
            let wanted = SymFlags::VALUE | SymFlags::NAMESPACE;
            let nearest = files
                .resolve_name(cx.file, scope, path[0], wanted)
                .and_then(|found| {
                    if files.flags(found).intersects(wanted) {
                        Some(found)
                    } else {
                        files.resolve_alias(found)
                    }
                });
            if let Some(nearest) = nearest
                && !files.flags(nearest).intersects(SymFlags::NAMESPACE)
                && let Some(start) = after_equals(cx.text, import.name_pos)
            {
                out.push(Diagnostic { start, code: 2437 });
            }
        }
        // `checkTypeNameIsReserved`
        if flags.intersects(SymFlags::TYPE)
            && matches!(
                files.atoms.bytes(import.name),
                b"any"
                    | b"unknown"
                    | b"never"
                    | b"number"
                    | b"bigint"
                    | b"boolean"
                    | b"string"
                    | b"symbol"
                    | b"void"
                    | b"object"
                    | b"undefined"
            )
        {
            out.push(Diagnostic {
                start: import.name_pos,
                code: 2438,
            });
        }
    }

    /// `checkExportDeclaration`, of `export { .. }`
    fn xm_export_named(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        x: ExportId,
        around: Around,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let export = hir[x];
        cx.modifiers_before_export(pos, 1193, around, out);
        if export.spec.is_none() || self.xm_is_in_place(cx, pos, export.spec, true, around, out) {
            let is_missing = if export.spec.is_none() {
                false
            } else if export.items.is_empty() {
                // Without a name to look up nobody asks for the module.
                self.xm_leave_alone(cx, pos, export.spec, false, false, out);
                true
            } else {
                self.xm_module_is_missing(
                    cx,
                    pos,
                    export.spec,
                    self.xm_is_collected(cx, export.spec, around),
                    out,
                )
            };
            // `checkExportSpecifier`, `checkAliasSymbol`
            if !is_missing
                && cx.verbatim_commonjs
                && !cx.is_js
                && !around.is_ambient
                && !export.type_only
            {
                for s in export.items.iter() {
                    let target = if export.spec.is_some() {
                        self.xm_module_of_specifier(cx.file, export.spec)
                            .and_then(|module| files.module_export(module, hir[s].local))
                    } else {
                        files.resolve_name(
                            cx.file,
                            bound.export_scope[x.idx()],
                            hir[s].local,
                            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
                        )
                    };
                    if !hir[s].type_only
                        && target
                            .and_then(|t| files.resolve_alias_if_needed(t))
                            .is_some()
                    {
                        out.push(Diagnostic {
                            start: hir[s].local_pos,
                            code: cx.esm_syntax_code,
                        });
                        self.note(
                            hir[s].local_pos,
                            self.end_of_export_spec(cx.file, s),
                            cx.esm_syntax_code,
                            Vec::new(),
                        );
                    }
                }
            }
            let is_in_ambient_namespace = export.spec.is_none() && around.is_ambient;
            if around.module.is_some() && !around.is_ambient_module && !is_in_ambient_namespace {
                let start = statement_start(cx.text, pos);
                out.push(Diagnostic { start, code: 1194 });
                self.note(start, self.xm_statement_end(cx, pos), 1194, Vec::new());
            }
        } else {
            // What a file exports other files may ask for.
            let may_be_used = around.module.is_none()
                || export
                    .items
                    .iter()
                    .any(|s| self.xm_follows_a_dot_somewhere(cx, hir[s].exported));
            self.xm_leave_alone(cx, pos, export.spec, false, may_be_used, out);
        }
        self.xm_import_attributes(cx, pos, export.spec, export.type_only, true, out);
    }

    /// `checkExportDeclaration`, of `export * from` and `export * as alias from`
    fn xm_export_star(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        spec: Atom,
        alias: Atom,
        around: Around,
        out: &mut Vec<Diagnostic>,
    ) {
        let files = self.files();
        // `export type *`
        let star = after_export(cx.text, pos);
        let is_type_only = word_at(cx.text, star) == b"type";
        cx.modifiers_before_export(pos, 1193, around, out);
        if self.xm_is_in_place(cx, pos, spec, true, around, out) {
            if !self.xm_module_is_missing(
                cx,
                pos,
                spec,
                self.xm_is_collected(cx, spec, around),
                out,
            ) && let Some(module) = self.xm_module_of_specifier(cx.file, spec)
            {
                // `hasExportAssignmentSymbol`
                if files.export(module, known::export_equals).is_some() {
                    if let Some(written) = cx.specifier(pos, spec) {
                        out.push(Diagnostic {
                            start: written.pos,
                            code: 2498,
                        });
                        cx.named_symbols
                            .borrow_mut()
                            .push((written.pos, 2498, module));
                    }
                } else if alias.is_some()
                    && cx.verbatim_commonjs
                    && !cx.is_js
                    && !around.is_ambient
                    && !is_type_only
                    && cx.text.get(star) == Some(&b'*')
                {
                    // `checkAliasSymbol`, of what starts at the star.
                    out.push(Diagnostic {
                        start: star as u32,
                        code: cx.esm_syntax_code,
                    });
                    // `* as alias`
                    let word = skip_trivia(cx.text, star + 1);
                    let name = skip_trivia(cx.text, word_end(cx.text, word));
                    let end = self.end_of_name_at(cx.file, name as u32);
                    self.note(star as u32, end, cx.esm_syntax_code, Vec::new());
                }
            }
        } else {
            let may_be_used = around.module.is_none()
                || alias.is_some() && self.xm_follows_a_dot_somewhere(cx, alias);
            self.xm_leave_alone(cx, pos, spec, false, may_be_used, out);
        }
        self.xm_import_attributes(cx, pos, spec, is_type_only, true, out);
    }

    /// `checkExportAssignment`
    fn xm_export_assignment(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        e: ExprId,
        is_export_equals: bool,
        around: Around,
        out: &mut Vec<Diagnostic>,
    ) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        let start = statement_start(cx.text, pos);
        if around.module.is_some() && !around.is_ambient_module {
            let code = if is_export_equals { 1063 } else { 1319 };
            out.push(Diagnostic { start, code });
            self.note(start, self.xm_statement_end(cx, pos), code, Vec::new());
            return;
        }
        cx.modifiers_before_export(pos, 1120, around, out);
        // The rest is about what a compiler that sees one file at a time makes of it.
        if around.is_ambient || !self.p.files.options.isolated_modules {
            return;
        }
        // `isIllegalExportDefaultInCJS`: nothing else is said then.
        if !is_export_equals && cx.verbatim_commonjs {
            out.push(Diagnostic {
                start,
                code: cx.esm_syntax_code,
            });
            self.note(
                start,
                self.xm_statement_end(cx, pos),
                cx.esm_syntax_code,
                Vec::new(),
            );
            return;
        }
        let ExprKind::Ident(name) = hir[e].kind else {
            return;
        };
        if hir.parens.binary_search_by_key(&e, |p| p.0).is_ok() {
            return;
        }
        let Some(&scope) = bound.expr_scope.get(&e) else {
            return;
        };
        let Some(sym) = files.resolve_name(
            cx.file,
            scope,
            name,
            SymFlags::VALUE | SymFlags::TYPE | SymFlags::NAMESPACE,
        ) else {
            return;
        };
        let mut report = |equals: u32, default: u32| {
            let code = if is_export_equals { equals } else { default };
            out.push(Diagnostic {
                start: hir[e].pos,
                code,
            });
            self.note(
                hir[e].pos,
                0,
                code,
                vec![self.atom_text(name), isolated_modules_like_flag_name(files)],
            );
        };
        let type_only = self.xm_type_only_declaration(sym, SymFlags::VALUE);
        // What cannot be followed may be anything: `SymbolFlagsAll`.
        let flags = self.xm_symbol_flags(sym, false).unwrap_or(SymFlags::all());
        if cx.is_verbatim {
            if !flags.intersects(SymFlags::VALUE) {
                report(1282, 1284);
            } else if type_only.is_some() {
                report(1283, 1285);
            }
        }
        let own = files.flags(sym);
        if !own.intersects(SymFlags::VALUE) {
            let elsewhere = self.xm_symbol_flags(sym, true).unwrap_or(SymFlags::all());
            if own.contains(SymFlags::ALIAS)
                && elsewhere.intersects(SymFlags::TYPE)
                && !elsewhere.intersects(SymFlags::VALUE)
                && type_only != Some(cx.file)
            {
                report(1291, 1292);
            } else if type_only.is_some_and(|of| of != cx.file) {
                report(1289, 1290);
            }
        }
    }

    /// `getSymbolFlagsEx`: all that `sym` means, that what it stands for means, and so on. `None`: the way there breaks off.
    fn xm_symbol_flags(&self, mut sym: Sym, exclude_local_meanings: bool) -> Option<SymFlags> {
        let files = self.files();
        let mut flags = if exclude_local_meanings {
            SymFlags::empty()
        } else {
            files.flags(sym)
        };
        for _ in 0..32 {
            if !files.flags(sym).contains(SymFlags::ALIAS) {
                break;
            }
            let target = files.alias_target(sym)?;
            if target == sym {
                break;
            }
            flags |= files.flags(target);
            sym = target;
        }
        Some(flags)
    }

    /// `getTypeOnlyAliasDeclarationEx`: the file of the first step from `sym` to what it stands for that is only about types, before
    /// anything on the way has `meaning` itself.
    fn xm_type_only_declaration(&self, mut sym: Sym, meaning: SymFlags) -> Option<FileId> {
        let files = self.files();
        for _ in 0..32 {
            let flags = files.flags(sym);
            if !flags.contains(SymFlags::ALIAS) || flags.intersects(meaning) {
                return None;
            }
            let hir = files.hir(sym.file);
            // `markSymbolOfAliasDeclarationIfTypeOnly`, `IsTypeOnlyImportOrExportDeclaration`
            let is_type_only = files.symbol(sym).decls.iter().any(|&decl| match decl {
                // `getTargetOfImportClause` gets no further than a module that is not there.
                Decl::ImportDefault(i) => {
                    hir[i].type_only && files.module_of_specifier(sym.file, hir[i].spec).is_some()
                }
                Decl::ImportNamespace(i) => hir[i].type_only,
                Decl::ImportSpec(s) => {
                    hir[s].type_only
                        || hir
                            .imports
                            .iter()
                            .any(|i| i.type_only && i.named.range().contains(&s.idx()))
                }
                Decl::ImportEquals(i) => hir[i].flags.contains(Flags::TYPE_ONLY),
                Decl::ExportSpec(s) => {
                    hir[s].type_only
                        || hir
                            .exports
                            .iter()
                            .any(|x| x.type_only && x.items.range().contains(&s.idx()))
                }
                Decl::ExportStarAs(s) => {
                    word_at(&hir.text, after_export(&hir.text, hir[s].pos)) == b"type"
                }
                _ => false,
            });
            if is_type_only {
                return Some(sym.file);
            }
            sym = files.alias_target(sym)?;
        }
        None
    }

    // ───────────────────────────── import attributes ─────────────────────────────

    /// `checkImportAttributes`, of the statement at `pos` that names the module `spec`.
    fn xm_import_attributes(
        &self,
        cx: &Cx<'_>,
        pos: u32,
        spec: Atom,
        is_type_only: bool,
        is_export: bool,
        out: &mut Vec<Diagnostic>,
    ) {
        if spec.is_none() {
            return;
        }
        let Some(written) = cx.specifier(pos, spec) else {
            return;
        };
        let Some((attributes, object)) =
            self.xm_attributes_after(cx, written.pos, is_export, |_, _| {})
        else {
            return;
        };
        if object.is_some() {
            cx.attribute_types.borrow_mut().push((
                attributes.start,
                attributes.end,
                AttributesType::Object(object),
            ));
        } else if let Some(ty) = self.type_from_import_attributes(&attributes) {
            cx.attribute_types.borrow_mut().push((
                attributes.start,
                attributes.end,
                AttributesType::Known(ty),
            ));
        }
        // The remaining checks report with `grammarErrorOnNode`.
        if !cx.grammar {
            return;
        }
        let overrides = attributes.overrides_resolution_mode(self, is_type_only, out);
        if is_type_only && overrides {
            return;
        }
        // `SupportsImportAttributes`
        let kind = self.p.files.options.module;
        let code = if !((ModuleKind::Node18..=ModuleKind::NodeNext).contains(&kind)
            || matches!(kind, ModuleKind::Preserve | ModuleKind::EsNext))
        {
            2823
        } else if self.xm_emits_commonjs(cx.file) {
            // `getEmitSyntaxForModuleSpecifierExpression`
            2856
        } else if is_type_only {
            2857
        } else if overrides {
            1454
        } else {
            return;
        };
        out.push(Diagnostic {
            start: attributes.start,
            code,
        });
        self.note(attributes.start, attributes.end, code, Vec::new());
    }

    /// `getTypeFromImportAttributes`: a non-fresh object type with one property per attribute, typed as the regular literal type of its
    /// value. Returns `None` if the text does not give the type of every value: a value is not a string, or has escapes.
    fn type_from_import_attributes(&self, attributes: &Attributes<'_>) -> Option<TypeId> {
        let atoms = &self.files().atoms;
        let mut props: Vec<Prop> = Vec::with_capacity(attributes.entries.len());
        for &(name, value) in &attributes.entries {
            let value = value?;
            if name.contains(&b'\\') || value.contains(&b'\\') {
                return None;
            }
            let name = atoms.intern(name);
            let ty = self.string_literal(atoms.intern(value), false);
            // `members[member.Name] = member`: the last attribute with a given name wins.
            props.retain(|p| p.name != name);
            props.push(Prop {
                name,
                flags: PropFlags::empty(),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            });
        }
        Some(self.synth(Shape {
            props,
            ..Shape::default()
        }))
    }

    /// `getTypeFromImportAttributes`, from the attributes as the parser kept them. Returns `None` if the type of a value is unknown.
    fn type_from_import_attributes_object(
        &mut self,
        file: FileId,
        object: ExprId,
    ) -> Option<TypeId> {
        let hir = self.hir(file);
        let ExprKind::Object(attributes) = hir[object].kind else {
            return None;
        };
        let mut props: Vec<Prop> = Vec::with_capacity(attributes.len());
        for attribute in attributes.iter() {
            let (name, value) = (hir[attribute].key.name()?, hir[attribute].value);
            let ty = self.type_of_expr(file, value);
            if !self.is_known(ty) || self.is_uncertain(file, value) {
                return None;
            }
            let ty = self.regular(ty);
            // `members[member.Name] = member`: the last attribute with a given name wins.
            props.retain(|p| p.name != name);
            props.push(Prop {
                name,
                flags: PropFlags::empty(),
                source: PropSource::Type(ty),
                mapper: MapperId::IDENTITY,
            });
        }
        Some(self.synth(Shape {
            props,
            ..Shape::default()
        }))
    }

    /// `checkImportAttributes`: reports 2322 at the keyword unless the attributes are assignable to the global `ImportAttributes`.
    /// tsgo reports it with a plain `error`, so parse diagnostics do not suppress it.
    fn check_import_attribute_types(&mut self, cx: &Cx<'_>, out: &mut Vec<Diagnostic>) {
        let attribute_types = cx.attribute_types.take();
        if attribute_types.is_empty() {
            return;
        }
        // `getGlobalImportAttributesTypeChecked` returns `emptyObjectType` if there is no such interface, and the check is skipped.
        let Some(sym) = self
            .files()
            .atoms
            .lookup(b"ImportAttributes")
            .and_then(|name| self.global_type_of_arity(name, 0))
        else {
            return;
        };
        let target = self.declared_type(sym);
        // `getNullableType(importAttributesType, TypeFlagsUndefined)`
        let target = self.optional(target);
        for (start, end, source) in attribute_types {
            let source = match source {
                AttributesType::Known(ty) => Some(ty),
                AttributesType::Object(object) => {
                    self.type_from_import_attributes_object(cx.file, object)
                }
            };
            if let Some(source) = source {
                self.check_assignable_with_end(
                    cx.file,
                    source,
                    target,
                    start,
                    end,
                    ExprId::NONE,
                    2322,
                    out,
                );
            }
        }
    }

    /// `getExternalModuleMember`: a property of the value a module is with `export =` is what the imported name stands for.
    fn check_members_of_export_equals(&mut self, cx: &Cx<'_>, out: &mut Vec<Diagnostic>) {
        for (sym, specifier) in cx.members_of_export_equals.take() {
            if self.imported_property_of_export_equals(sym).is_some() {
                let start = self.hir(cx.file)[specifier].imported_pos;
                out.push(Diagnostic {
                    start,
                    code: cx.esm_syntax_code,
                });
                self.note(
                    start,
                    self.end_of_import_spec(cx.file, specifier),
                    cx.esm_syntax_code,
                    Vec::new(),
                );
            }
        }
    }

    /// `checkGrammarImportCallExpression`, `checkImportType`, `getTypeFromImportTypeNode`
    fn xm_import_calls_and_types(&mut self, cx: &Cx<'_>, out: &mut Vec<Diagnostic>) {
        let (hir, bound, files) = (self.hir(cx.file), self.bound(cx.file), self.files());
        if cx.grammar && cx.is_verbatim && self.p.files.options.module == ModuleKind::CommonJs {
            let index = self.exprs_by_kind(cx.file);
            for &e in index.of(ExprTag::ImportCall) {
                if !matches!(bound.expr_parent[e.idx()], Parent::None) {
                    let start = hir[e].pos;
                    out.push(Diagnostic {
                        start,
                        code: cx.esm_syntax_code,
                    });
                    self.note(
                        start,
                        self.end_inside_parentheses(cx.file, e),
                        cx.esm_syntax_code,
                        Vec::new(),
                    );
                }
            }
        }
        for (i, node) in hir.types.iter().enumerate() {
            let TypeNodeKind::Import {
                spec,
                name,
                is_typeof,
                ..
            } = node.kind
            else {
                continue;
            };
            if bound.type_scope[i].is_none() {
                continue;
            }
            if cx.grammar
                && let Some(written) = cx.specifier(node.pos, spec)
                && let Some(attributes) = import_type_attributes(cx.text, written.pos as usize)
            {
                attributes.overrides_resolution_mode(self, true, out);
            }
            if !name.is_empty() {
                continue;
            }
            // The module itself, or what it says it is, has to be what is asked for.
            let Some(module) = self.xm_module_of_specifier(cx.file, spec) else {
                continue;
            };
            let Some(flags) = self.xm_symbol_flags(files.module_value(module), false) else {
                continue;
            };
            if !flags.intersects(if is_typeof {
                SymFlags::VALUE
            } else {
                SymFlags::TYPE
            }) {
                let code = if is_typeof { 1339 } else { 1340 };
                out.push(Diagnostic {
                    start: node.pos,
                    code,
                });
                self.note(
                    node.pos,
                    self.end_of_type_node(cx.file, TypeNodeId(i as u32)),
                    code,
                    vec![self.atom_text(spec)],
                );
            }
        }
    }

    // ───────────────────────────── what is written where it cannot be ─────────────────────────────

    /// `checkGrammarModuleElementContext` and `reportObviousModifierErrors`, of the statements that are neither at the top of the file
    /// nor at the top of a namespace. 1211 for a class declaration without a name, wherever it is.
    fn xm_statements_in_blocks(&self, cx: &Cx<'_>, out: &mut Vec<Diagnostic>) {
        if !cx.grammar || cx.text.is_empty() {
            return;
        }
        let (hir, bound) = (self.hir(cx.file), self.bound(cx.file));
        for (i, s) in hir.stmts.iter().enumerate() {
            // Only declarations, imports and exports are looked at.
            if !matches!(
                s.kind,
                StmtKind::Var(_)
                    | StmtKind::Fn(_)
                    | StmtKind::Class(_)
                    | StmtKind::Interface(_)
                    | StmtKind::TypeAlias(_)
                    | StmtKind::Enum(_)
                    | StmtKind::Module(_)
                    | StmtKind::Import(_)
                    | StmtKind::ImportEquals(_)
                    | StmtKind::ExportNamed(_)
                    | StmtKind::ExportStar { .. }
                    | StmtKind::ExportAssign(_)
                    | StmtKind::ExportDefault(_)
            ) || matches!(bound.stmt_parent[i], Parent::None)
            {
                continue;
            }
            // `checkClassDeclaration`: only `export default class` can do without a name.
            if let StmtKind::Class(c) = s.kind
                && hir[c].name.is_none()
                && !hir[c].flags.contains(Flags::DEFAULT)
                // `default` without `export` (1029) is a modifier all the same.
                && find_modifier(cx.text, statement_start(cx.text, s.pos), b"default").is_none()
            {
                let start = class_declaration_start(hir, s.pos, c);
                out.push(Diagnostic { start, code: 1211 });
                self.note(
                    start,
                    self.end_of_token_at(cx.file, start),
                    1211,
                    Vec::new(),
                );
            }
            if matches!(bound.stmt_parent[i], Parent::File | Parent::Module(_)) {
                continue;
            }
            let code = match s.kind {
                StmtKind::Module(m) if matches!(hir[m].name, ModuleName::Ident(_)) => 1235,
                StmtKind::Module(_) => 1234,
                StmtKind::Import(_) | StmtKind::ImportEquals(_) => {
                    if cx.is_js {
                        1473
                    } else {
                        1232
                    }
                }
                StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } => {
                    if cx.is_js {
                        1474
                    } else {
                        1233
                    }
                }
                StmtKind::ExportAssign(_) => 1231,
                StmtKind::ExportDefault(_) => 1258,
                _ => 1184,
            };
            if code != 1184 {
                out.push(Diagnostic {
                    start: statement_start(cx.text, s.pos),
                    code,
                });
                continue;
            }
            // `findFirstIllegalModifier`: the one modifier that may come first.
            let allowed: &[u8] = match s.kind {
                StmtKind::Fn(_) => b"async",
                StmtKind::Class(_) => b"abstract",
                _ => b"",
            };
            let flags = match s.kind {
                StmtKind::Fn(f) => hir[f].flags.difference(Flags::ASYNC),
                StmtKind::Class(c) => hir[c].flags.difference(Flags::ABSTRACT),
                StmtKind::Interface(i) => hir[i].flags,
                StmtKind::TypeAlias(a) => hir[a].flags,
                StmtKind::Enum(e) => hir[e].flags,
                StmtKind::Var(decls) => {
                    decls.iter().next().map_or(Flags::empty(), |d| hir[d].flags)
                }
                _ => continue,
            };
            // Whether there is a modifier is known. The text is only read for where the first one is.
            if !flags.intersects(MODIFIERS) {
                continue;
            }
            let start = statement_start(cx.text, s.pos);
            let first = word_at(cx.text, start as usize);
            if first != allowed && is_modifier(first, false) {
                out.push(Diagnostic { start, code });
            }
        }
    }

    /// `reportObviousModifierErrors`, of `static { }`: nothing goes before it.
    fn xm_static_blocks(&self, cx: &Cx<'_>, out: &mut Vec<Diagnostic>) {
        if !cx.grammar || cx.text.is_empty() {
            return;
        }
        let (hir, bound) = (self.hir(cx.file), self.bound(cx.file));
        for (i, member) in hir.members.iter().enumerate() {
            if member.kind != MemberKind::StaticBlock
                || matches!(bound.member_owner[i], MemberOwner::None)
            {
                continue;
            }
            // It is said to be where its brace is, or, in a class that is only declared, where its first modifier is.
            let (start, keyword) = if cx.text.get(member.pos as usize) == Some(&b'{') {
                let end = skip_trivia_back(cx.text, member.pos as usize);
                let keyword = word_start(cx.text, end);
                if &cx.text[keyword..end] != b"static" {
                    continue;
                }
                (statement_start(cx.text, keyword as u32), keyword as u32)
            } else {
                let Some(keyword) = find_modifier(cx.text, member.pos, b"static") else {
                    continue;
                };
                (member.pos, keyword)
            };
            if start != keyword {
                out.push(Diagnostic { start, code: 1184 });
            }
        }
    }
}

// ───────────────────────────── whether the file parses ─────────────────────────────

/// `hasParseDiagnostics`. What the parser objected to and went on from is kept with what tsgo's binder and checker say of syntax. They
/// are told apart by the code: these are the ones only parser.go and scanner.go give a TypeScript file, and those they share with the
/// checker that are the parser's whenever the summary has them.
fn has_parse_diagnostics(hir: &hir::File) -> bool {
    hir.has_parse_diagnostics
        || hir.has_errors
        || hir.syntax_errors > 0
        || hir.early_errors.iter().any(|&(_, code)| {
            matches!(
                code,
                1002 | 1003 | 1005 | 1007 | 1010..=1012 | 1034 | 1068 | 1069 | 1084 | 1109 | 1110 | 1121 | 1124..=1132 | 1134..=1140
                    | 1144..=1146 | 1160 | 1161 | 1177..=1181 | 1185 | 1198 | 1199 | 1209 | 1223 | 1260 | 1327 | 1328 | 1351..=1353
                    | 1357 | 1381 | 1382 | 1385..=1390 | 1433..=1443 | 1453 | 1472 | 1477 | 1478 | 1487..=1490 | 2657 | 2754 | 2809
                    | 2819 | 2880 | 6188 | 6189 | 17002 | 17006..=17008 | 17014 | 17015 | 17021 | 18009 | 18026 | 18029 | 18030
            )
        })
}

/// `tryParseImportAttributes`, `parseExportDeclaration`, `parseImportType`: `assert` where `with` belongs is an error of the parser's.
fn has_import_assertions(text: &[u8], uses: &[SpecifierUse]) -> bool {
    uses.iter().any(|u| {
        let Some(end) = string_end(text, u.pos as usize) else {
            return false;
        };
        let mut at = skip_trivia(text, end);
        if text.get(at) != Some(&b',') {
            return word_at(text, at) == b"assert" && !has_line_break(&text[end..at]);
        }
        // `import("m", { assert: { .. } })`
        at = skip_trivia(text, at + 1);
        text.get(at) == Some(&b'{') && word_at(text, skip_trivia(text, at + 1)) == b"assert"
    })
}

// ───────────────────────────── names of modules ─────────────────────────────

/// `IsExternalModuleNameRelative`
fn is_relative_name(name: &[u8]) -> bool {
    match name {
        // `PathIsRelative`
        [b'.'] | [b'.', b'.'] | [b'.', b'/' | b'\\', ..] | [b'.', b'.', b'/' | b'\\', ..] => true,
        // `IsRootedDiskPath`
        [b'/' | b'\\', ..] | [b'^', b'/', ..] => true,
        [volume, b':'] | [volume, b':', b'/' | b'\\', ..] => volume.is_ascii_alphabetic(),
        _ => false,
    }
}

/// `getSuggestedImportExtension`, of the relative `spec` written in the file `from`. Only the files of the program are known to be there.
pub(super) fn suggested_import_extension(
    files: &Files,
    from: &str,
    spec: &str,
) -> Option<&'static str> {
    let stem = crate::resolve::join(crate::resolve::parent_dir(from), spec);
    let for_tsx = if files.options.jsx == crate::resolve::JsxEmit::Preserve {
        ".jsx"
    } else {
        ".js"
    };
    [
        (".mts", ".mjs"),
        (".ts", ".js"),
        (".cts", ".cjs"),
        (".mjs", ".mjs"),
        (".js", ".js"),
        (".cjs", ".cjs"),
        (".tsx", for_tsx),
        (".jsx", ".jsx"),
        (".json", ".json"),
    ]
    .into_iter()
    .find(|(written, _)| files.by_path.contains_key(&format!("{stem}{written}")))
    .map(|(_, suggested)| suggested)
}

// ───────────────────────────── what goes into messages ─────────────────────────────

/// `getIsolatedModulesLikeFlagName`
pub(super) fn isolated_modules_like_flag_name(files: &Files) -> String {
    if files.options.verbatim_module_syntax {
        "verbatimModuleSyntax".to_owned()
    } else {
        "isolatedModules".to_owned()
    }
}

/// `ModuleKind.String`
pub(super) fn module_kind_name(kind: ModuleKind) -> &'static str {
    match kind {
        ModuleKind::CommonJs => "CommonJS",
        ModuleKind::Amd => "AMD",
        ModuleKind::Umd => "UMD",
        ModuleKind::System => "System",
        ModuleKind::Es2015 => "ES2015",
        ModuleKind::Es2020 => "ES2020",
        ModuleKind::Es2022 => "ES2022",
        ModuleKind::EsNext => "ESNext",
        ModuleKind::Node16 => "Node16",
        ModuleKind::Node18 => "Node18",
        ModuleKind::Node20 => "Node20",
        ModuleKind::NodeNext => "NodeNext",
        ModuleKind::Preserve => "Preserve",
    }
}

/// `node.End()` of the import clause of the declaration whose module specifier is at `spec_pos`: where what comes before the `from`
/// ends. 0 if there is no `from`.
pub(super) fn import_clause_end(text: &[u8], spec_pos: u32) -> u32 {
    let end = skip_trivia_back(text, spec_pos as usize);
    let from = word_start(text, end);
    if &text[from..end] != b"from" {
        return 0;
    }
    skip_trivia_back(text, from) as u32
}

// ───────────────────────────── import attributes, as they are written ─────────────────────────────

struct Attribute<'a> {
    name: &'a [u8],
    name_pos: u32,
    name_is_string: bool,
    /// `IsStringLiteralLike`: what is between the quotes, of whichever kind they are.
    value: Option<&'a [u8]>,
    value_pos: u32,
}

/// `with { name: "value", .. }`
struct Attributes<'a> {
    /// Where the node starts: at the keyword, or at the brace in `import("m", { with: { .. } })`.
    start: u32,
    /// Where it ends: after the closing brace. 0 if that is not known.
    end: u32,
    first: Option<Attribute<'a>>,
    /// The name, without quotes, and the `Attribute::value` of every attribute.
    entries: Vec<(&'a [u8], Option<&'a [u8]>)>,
}

impl Attributes<'_> {
    /// `getResolutionModeOverride`: whether they say how the module is to be looked for.
    fn overrides_resolution_mode(
        &self,
        c: &Checker<'_>,
        report_errors: bool,
        out: &mut Vec<Diagnostic>,
    ) -> bool {
        let mut report = |start: u32, code: u32| {
            if report_errors {
                out.push(Diagnostic { start, code });
            }
        };
        let Some(only) = self.first.as_ref().filter(|_| self.entries.len() == 1) else {
            report(self.start, 1464);
            c.note(self.start, self.end, 1464, Vec::new());
            return false;
        };
        if !only.name_is_string {
            return false;
        }
        if only.name != b"resolution-mode" {
            report(only.name_pos, 1463);
            return false;
        }
        let Some(value) = only.value else {
            return false;
        };
        if value != b"import" && value != b"require" {
            report(only.value_pos, 1453);
            return false;
        }
        true
    }
}

impl<'p> Checker<'p> {
    /// The attributes after the module specifier at `spec_pos` of an import or export declaration, and the `ExprKind::Object` the
    /// parser kept them as (`hir::File::import_attributes`). They are read from the text, and the object is `NONE`, if it kept none.
    /// `on_other_value`: called with the start and the end of each value that is not a string in single or double quotes.
    fn xm_attributes_after<'a>(
        &self,
        cx: &Cx<'a>,
        spec_pos: u32,
        is_export: bool,
        mut on_other_value: impl FnMut(u32, u32),
    ) -> Option<(Attributes<'a>, ExprId)>
    where
        'p: 'a,
    {
        let (keyword, keyword_end) = cx.attributes_keyword(spec_pos, is_export)?;
        let start = keyword as u32;
        let (hir, atoms) = (self.hir(cx.file), &self.files().atoms);
        let Some(&(_, object)) = hir.import_attributes.iter().find(|kept| kept.0 == start) else {
            let attributes = parse_attributes(
                cx.text,
                skip_trivia(cx.text, keyword_end),
                start,
                on_other_value,
            )?;
            return Some((attributes, ExprId::NONE));
        };
        let ExprKind::Object(props) = hir[object].kind else {
            return None;
        };
        let open = skip_trivia(cx.text, keyword_end);
        let mut attributes = Attributes {
            start,
            end: if cx.text.get(open) == Some(&b'{') {
                self.end_of_bracket_at(cx.file, open as u32)
            } else {
                0
            },
            first: None,
            entries: Vec::with_capacity(props.len()),
        };
        for p in props.iter() {
            let prop = &hir[p];
            let name: &'a [u8] = prop.key.name().map_or(&[][..], |name| atoms.bytes(name));
            let value_pos = self.start_of(cx.file, prop.value);
            // Parentheses make it another kind of node. A template without substitutions may be lowered to a `String`.
            let quote = cx
                .text
                .get(value_pos as usize)
                .copied()
                .filter(|&c| matches!(c, b'"' | b'\'' | b'`'));
            let value: Option<&'a [u8]> = match hir[prop.value].kind {
                ExprKind::String(value) if quote.is_some() => Some(atoms.bytes(value)),
                ExprKind::Template { exprs, texts } if exprs.is_empty() && quote.is_some() => {
                    hir.ids(texts).next().map(|text| atoms.bytes(text))
                }
                _ => None,
            };
            // The parser has reported a missing value.
            if (value.is_none() || quote == Some(b'`'))
                && !matches!(hir[prop.value].kind, ExprKind::Missing)
            {
                on_other_value(value_pos, self.end_of_expr(cx.file, prop.value));
            }
            if attributes.first.is_none() {
                let name_is_string = matches!(cx.text.get(prop.pos as usize), Some(b'"' | b'\''));
                attributes.first = Some(Attribute {
                    name,
                    name_pos: prop.pos,
                    name_is_string,
                    value,
                    value_pos,
                });
            }
            attributes.entries.push((name, value));
        }
        Some((attributes, object))
    }
}

/// The start and the end of the `with` or `assert` after the module specifier at `spec_pos` of an import or export declaration.
fn attributes_keyword(text: &[u8], spec_pos: u32, is_export: bool) -> Option<(usize, usize)> {
    let end = string_end(text, spec_pos as usize)?;
    let keyword = skip_trivia(text, end);
    let word = word_at(text, keyword);
    // `tryParseImportAttributes` accepts `with` on any line and `assert` on the same line only. `parseExportDeclaration` accepts both
    // on the same line only. The parser reports `assert` and still builds the node.
    let must_be_on_same_line = match word {
        b"with" => is_export,
        b"assert" => true,
        _ => return None,
    };
    if must_be_on_same_line && has_line_break(&text[end..keyword]) {
        return None;
    }
    Some((keyword, keyword + word.len()))
}

/// `parseImportAttributes`, from the brace at `open`. `None` for what does not parse, or cannot be told to.
fn parse_attributes(
    text: &[u8],
    open: usize,
    start: u32,
    mut on_other_value: impl FnMut(u32, u32),
) -> Option<Attributes<'_>> {
    if text.get(open) != Some(&b'{') {
        return None;
    }
    let mut at = skip_trivia(text, open + 1);
    let mut attributes = Attributes {
        start,
        end: 0,
        first: None,
        entries: Vec::new(),
    };
    while text.get(at) != Some(&b'}') {
        let name_pos = at;
        let name_is_string = matches!(text.get(at), Some(b'"' | b'\''));
        let name_end = if name_is_string {
            string_end(text, at)?
        } else {
            word_end(text, at)
        };
        if name_end == name_pos {
            return None;
        }
        at = skip_trivia(text, name_end);
        if text.get(at) != Some(&b':') {
            return None;
        }
        let value_pos = skip_trivia(text, at + 1);
        let (value, value_end) = match string_end(text, value_pos) {
            Some(end) => (Some(&text[value_pos + 1..end - 1]), end),
            None => {
                let end = expression_end(text, value_pos).filter(|&end| end > value_pos)?;
                on_other_value(value_pos as u32, skip_trivia_back(text, end) as u32);
                // A template that nothing is substituted in.
                match text[value_pos..end].trim_ascii_end() {
                    [b'`', inner @ .., b'`'] if !inner.contains(&b'`') => (Some(inner), end),
                    _ => (None, end),
                }
            }
        };
        let name = if name_is_string {
            &text[name_pos + 1..name_end - 1]
        } else {
            &text[name_pos..name_end]
        };
        if attributes.first.is_none() {
            attributes.first = Some(Attribute {
                name,
                name_pos: name_pos as u32,
                name_is_string,
                value,
                value_pos: value_pos as u32,
            });
        }
        attributes.entries.push((name, value));
        at = skip_trivia(text, value_end);
        match text.get(at) {
            Some(b',') => at = skip_trivia(text, at + 1),
            Some(b'}') => {}
            _ => return None,
        }
    }
    attributes.end = at as u32 + 1;
    Some(attributes)
}

/// The attributes of `import("m", { with: { .. } })`, whose `"m"` is at `spec_pos`.
fn import_type_attributes(text: &[u8], spec_pos: usize) -> Option<Attributes<'_>> {
    let mut at = skip_trivia(text, string_end(text, spec_pos)?);
    for expected in [b',', b'{'] {
        if text.get(at) != Some(&expected) {
            return None;
        }
        at = skip_trivia(text, at + 1);
    }
    if word_at(text, at) != b"with" {
        return None;
    }
    at = skip_trivia(text, at + 4);
    if text.get(at) != Some(&b':') {
        return None;
    }
    let open = skip_trivia(text, at + 1);
    parse_attributes(text, open, open as u32, |_, _| {})
}

/// Where the expression at `at` ends, which a `,` or a `}` follows. `None` if counting brackets does not tell.
fn expression_end(text: &[u8], mut at: usize) -> Option<usize> {
    let mut depth = 0u32;
    loop {
        match *text.get(at)? {
            b'"' | b'\'' => at = string_end(text, at)?,
            b'`' => {
                at += 1;
                loop {
                    match *text.get(at)? {
                        b'`' => break,
                        b'\\' => at += 2,
                        b'$' if text.get(at + 1) == Some(&b'{') => return None,
                        _ => at += 1,
                    }
                }
                at += 1;
            }
            // A comment. A division and a regular expression cannot be told apart from here.
            b'/' => {
                let after = skip_trivia(text, at);
                if after == at {
                    return None;
                }
                at = after;
            }
            b'(' | b'[' | b'{' => {
                depth += 1;
                at += 1;
            }
            b',' | b'}' if depth == 0 => return Some(at),
            b')' | b']' | b'}' => {
                depth = depth.checked_sub(1)?;
                at += 1;
            }
            _ => at += 1,
        }
    }
}

// ───────────────────────────── reading the text ─────────────────────────────

fn is_word_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$' || c >= 0x80
}

fn has_line_break(text: &[u8]) -> bool {
    text.iter().any(|&c| c == b'\n' || c == b'\r')
}

/// `SkipTrivia`: past white space and comments.
fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at) {
            Some(c) if c.is_ascii_whitespace() || *c == 0x0b => at += 1,
            Some(b'/') if text.get(at + 1) == Some(&b'/') => {
                while text.get(at).is_some_and(|&c| c != b'\n' && c != b'\r') {
                    at += 1;
                }
            }
            Some(b'/') if text.get(at + 1) == Some(&b'*') => {
                at += 2;
                while at < text.len() && !text[at..].starts_with(b"*/") {
                    at += 1;
                }
                at = (at + 2).min(text.len());
            }
            _ => return at,
        }
    }
}

/// The start of the first token of the file. The scanner skips a byte order mark and a `#!` line there like trivia.
fn first_token_start(text: &[u8]) -> u32 {
    let mut at = if text.starts_with(b"\xEF\xBB\xBF") {
        3
    } else {
        0
    };
    if text[at..].starts_with(b"#!") {
        at += text[at..]
            .iter()
            .position(|&c| c == b'\n' || c == b'\r')
            .unwrap_or(text.len() - at);
    }
    skip_trivia(text, at) as u32
}

/// Where the `//` comment of a line starts, going by the strings and comments before it.
fn line_comment_start(line: &[u8]) -> Option<usize> {
    let (mut i, mut quote) = (0, 0u8);
    while i < line.len() {
        let c = line[i];
        if quote != 0 {
            if c == b'\\' {
                i += 1;
            } else if c == quote {
                quote = 0;
            }
        } else if matches!(c, b'"' | b'\'' | b'`') {
            quote = c;
        } else if c == b'/' && line.get(i + 1) == Some(&b'/') {
            return Some(i);
        } else if c == b'/' && line.get(i + 1) == Some(&b'*') {
            i += 2 + line[i + 2..].windows(2).position(|w| w == b"*/")?;
            i += 1;
        }
        i += 1;
    }
    None
}

/// Where what comes before `at` ends, white space and comments aside.
fn skip_trivia_back(text: &[u8], at: usize) -> usize {
    let mut end = at.min(text.len());
    loop {
        while end > 0 && (text[end - 1].is_ascii_whitespace() || text[end - 1] == 0x0b) {
            end -= 1;
        }
        if text[..end].ends_with(b"*/")
            && let Some(open) = text[..end - 2].windows(2).rposition(|w| w == b"/*")
        {
            end = open;
            continue;
        }
        let line = text[..end]
            .iter()
            .rposition(|&c| c == b'\n' || c == b'\r')
            .map_or(0, |i| i + 1);
        match line_comment_start(&text[line..end]) {
            Some(comment) => end = line + comment,
            None => return end,
        }
    }
}

/// Where the identifier or keyword at `at` ends.
fn word_end(text: &[u8], mut at: usize) -> usize {
    while let Some(&c) = text.get(at) {
        if is_word_byte(c) {
            at += 1;
        } else if c == b'\\' && text.get(at + 1) == Some(&b'u') {
            // A Unicode escape, with four digits or with braces.
            at += 2;
            if text.get(at) == Some(&b'{') {
                while text.get(at).is_some_and(|&c| c != b'}') {
                    at += 1;
                }
                at = (at + 1).min(text.len());
            }
        } else {
            break;
        }
    }
    at
}

/// The identifier or keyword at `at`. Empty if there is none.
fn word_at(text: &[u8], at: usize) -> &[u8] {
    text.get(at..word_end(text, at)).unwrap_or(&[])
}

/// Where the word that ends at `end` starts.
fn word_start(text: &[u8], end: usize) -> usize {
    let mut start = end;
    while start > 0 && is_word_byte(text[start - 1]) {
        start -= 1;
    }
    // A byte order mark is white space.
    if text[start..end].starts_with(b"\xEF\xBB\xBF") {
        start += 3;
    }
    start
}

/// Past the string that opens at `at`.
fn string_end(text: &[u8], at: usize) -> Option<usize> {
    let quote = *text.get(at)?;
    if quote != b'"' && quote != b'\'' {
        return None;
    }
    let mut i = at + 1;
    loop {
        match *text.get(i)? {
            b'\\' => i += 2,
            b'\n' | b'\r' => return None,
            c if c == quote => return Some(i + 1),
            _ => i += 1,
        }
    }
}

/// The start of the string literal that ends at `end`.
fn string_start(text: &[u8], end: usize) -> Option<usize> {
    let mut open = end.checked_sub(1)?;
    let quote = *text.get(open)?;
    loop {
        open = text[..open].iter().rposition(|&c| c == quote)?;
        // An odd number of backslashes escapes the quote.
        if text[..open]
            .iter()
            .rev()
            .take_while(|&&c| c == b'\\')
            .count()
            % 2
            == 0
        {
            return (string_end(text, open) == Some(end)).then_some(open);
        }
    }
}

/// `nextTokenCanFollowModifier`: most of the words that can be modifiers are names unless what follows is on the same line.
fn is_modifier(word: &[u8], is_before_line_break: bool) -> bool {
    match word {
        b"export" | b"default" | b"static" => true,
        b"declare" | b"abstract" | b"async" | b"public" | b"private" | b"protected"
        | b"readonly" | b"override" | b"accessor" => !is_before_line_break,
        _ => false,
    }
}

/// Where the declaration said to be at `pos` starts. That may be past some or all of its modifiers.
fn statement_start(text: &[u8], pos: u32) -> u32 {
    let mut start = pos as usize;
    if start > text.len() {
        return pos;
    }
    loop {
        // On the same line only a word or the end of a comment is worth a closer look.
        if let Some(&c) = text[..start]
            .iter()
            .rev()
            .find(|&&c| c != b' ' && c != b'\t')
            && !is_word_byte(c)
            && !matches!(c, b'/' | b'\n' | b'\r')
        {
            return start as u32;
        }
        let end = skip_trivia_back(text, start);
        let word = word_start(text, end);
        // `a.default`, `"declare"`, `@async`
        let stands_alone = word == 0
            || !matches!(
                text[word - 1],
                b'.' | b'"' | b'\'' | b'`' | b'#' | b'@' | b'\\'
            );
        if !stands_alone || !is_modifier(&text[word..end], has_line_break(&text[end..start])) {
            return start as u32;
        }
        start = word;
    }
}

/// The start of the class declaration `c`, whose statement is at `pos`: its first decorator or modifier.
fn class_declaration_start(hir: &hir::File, mut pos: u32, c: ClassId) -> u32 {
    let text = &hir.text[..];
    if let Some(&(_, decorator)) = hir
        .decorators
        .iter()
        .find(|d| d.0 == DecoratorOwner::Class(c))
        && let Some(at) = text
            .get(..hir[decorator].pos as usize)
            .and_then(|before| before.iter().rposition(|&b| b == b'@'))
    {
        pos = pos.min(at as u32);
    }
    statement_start(text, pos)
}

/// The start of the first token of a statement list in braces. `None` if the HIR has no statement of the list.
fn statement_list_start(hir: &hir::File, statements: IdList<StmtId>) -> Option<u32> {
    let text = &hir.text[..];
    let first = hir.ids(statements).next()?;
    let mut start = match hir[first].kind {
        StmtKind::Class(c) => class_declaration_start(hir, hir[first].pos, c),
        _ => statement_start(text, hir[first].pos),
    } as usize;
    // The HIR drops directives, empty statements and `debugger` statements. They can precede `first`.
    loop {
        let end = skip_trivia_back(text, start);
        let token_start = match text[..end].last() {
            Some(b';') => Some(end - 1),
            Some(b'"' | b'\'') => string_start(text, end),
            _ => Some(word_start(text, end)).filter(|&word| &text[word..end] == b"debugger"),
        };
        match token_start {
            Some(token_start) => start = token_start,
            None => return Some(start as u32),
        }
    }
}

/// Where `wanted` is among the modifiers that start at `start`.
fn find_modifier(text: &[u8], start: u32, wanted: &[u8]) -> Option<u32> {
    let mut at = start as usize;
    loop {
        at = skip_trivia(text, at);
        let word = word_at(text, at);
        if word == wanted {
            return Some(at as u32);
        }
        if !is_modifier(word, false) {
            return None;
        }
        at += word.len();
    }
}

fn follows_a_dot(text: &[u8], pos: u32) -> bool {
    text[..skip_trivia_back(text, pos as usize)].ends_with(b".")
}

/// Whether the namespace whose name is at `name_pos` is declared with `module`. What holds for the `A` of `module A.B` holds for `B`.
fn says_module(text: &[u8], name_pos: u32, inherited: bool) -> bool {
    let end = skip_trivia_back(text, name_pos as usize);
    if text[..end].ends_with(b".") {
        return inherited;
    }
    &text[word_start(text, end)..end] == b"module"
}

/// Where what follows the `=` of `import name = ..` starts.
fn after_equals(text: &[u8], name_pos: u32) -> Option<u32> {
    let at = skip_trivia(text, word_end(text, name_pos as usize));
    (text.get(at) == Some(&b'=')).then(|| skip_trivia(text, at + 1) as u32)
}

/// Where what follows the `export` at `pos` starts.
fn after_export(text: &[u8], pos: u32) -> usize {
    skip_trivia(text, word_end(text, pos as usize))
}
