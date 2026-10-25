use super::code_barrels::summarize_requests;
use super::code_imports::resolve_code_imports;
use super::code_load::{Analyzed, CodeTarget, LoadKey, ParsedCodeFile};
use super::*;
use crate::bind::{BindOptions, RuntimeBindOptions};
use crate::file_analysis::{FileAnalysis, FileInputs, analyze_file};
use crate::fold::FoldInputs;
use crate::hir_from_data::HostValue;
use crate::import_sites::{AutomaticJsx, JsxMode, find_exported_requires};
use crate::module_format::DeclaredModuleType;
use crate::resolve::{
    CodeImportForm, CodeImportKind, CodeParseRequest, CodeRequest, CodeResolution, HostPayload,
    HostResolution, JsxRuntime, JsxSettings, MacroRequest, ParsedCode, TransformRequest,
    TranspileSettings, TreeChange,
};
use std::cmp::Ordering;

struct AcceptedTree<'s, 'r> {
    hir: hir::File<'s>,
    text: Cow<'static, [u8]>,
    host_values: &'s [(ExprId, HostValue<'s>)],
    payload: Option<HostPayload>,
    request: CodeParseRequest<'r>,
}

impl<'s> AcceptedTree<'s, '_> {
    fn replace_after_stack_overflow(
        &mut self,
        context: &CodeLoadContext<'_, 's, '_>,
        arena: &'s Arena,
    ) {
        let &CodeLoadContext {
            host, ref atoms, ..
        } = context;
        self.hir = hir::File {
            text: std::mem::take(&mut self.hir.text),
            source_len: self.hir.source_len,
            has_module_syntax: self.hir.has_module_syntax,
            has_errors: true,
            has_parse_diagnostics: true,
            ran_out_of_stack: true,
            ..host.parse_code(arena, &self.request, b"", atoms).hir
        };
    }
}

pub(super) fn load_code_file<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    arena: &'s Arena,
    target: CodeTarget<'r>,
    text: Cow<'static, [u8]>,
    is_called_before_it_runs: bool,
    imported_requires: &[ImportedRequire],
) -> ParsedCodeFile<'s, 'r> {
    let &CodeLoadContext {
        resolver,
        options,
        ref atoms,
        ..
    } = context;
    let key = target.key;
    let path = key.path;
    let specifies_esm = Files::specifies_esm(resolver, options, path, false);
    let settings = resolver.transpile_settings(path);
    let mut tree = accept_tree(context, arena, key, settings, text);
    debug_assert!(tree.hir.kind != FileKind::Declaration);
    tree.hir.imported_requires = ArenaFew::from_iter_in(imported_requires.iter().copied(), arena);
    let is_script_for_project = match tree.request.options.written_module_detection {
        ModuleDetection::Force => false,
        ModuleDetection::Legacy => true,
        ModuleDetection::Auto => {
            !specifies_esm && format_by_extension(path) == ResolutionMode::None
        }
    };
    if !(is_script_for_project && tree.hir.only_declares()) {
        let options = &tree.request.options;
        let imports_jsx_factory = options.written_module_detection == ModuleDetection::Auto
            && options.jsx_imports_its_factory
            && (tree.hir.exprs.iter()).any(|e| matches!(e.kind, ExprKind::Jsx(_)));
        let was_script =
            is_script_for_project && !tree.hir.has_module_syntax && !imports_jsx_factory;
        mark_as_module(&mut tree.hir);
        tree.hir.is_script_with_code =
            was_script && tree.hir.is_forced_module && tree.hir.declares_beside_code();
    }
    if tree.hir.text.is_empty() && tree.hir.source_len as usize == tree.text.len() {
        tree.hir.text = std::mem::take(&mut tree.text);
    }
    let fold = match is_called_before_it_runs {
        true => &*arena.alloc(context.inputs.fold.for_file_called_before_it_runs()),
        false => context.inputs.fold,
    };
    let (bound, analyzed) = analyze(context, arena, key, settings, fold, &mut tree);
    if !tree.request.options.keeps_comments {
        tree.hir.comments = Default::default();
    }
    rename_private_names_with(&mut tree.hir, &bound, atoms, path, |reference, _| {
        bound.runtime.private_class(reference)
    });
    let mut code = resolve_code_imports(context, key, &tree.hir, analyzed);
    code.add_implied(context, key, &tree.hir, &bound, &mut tree.payload);
    code.requests = summarize_requests(context, key, &tree.hir, &bound, &code);
    let decisions = &code.analyzed.analysis.decisions;
    code.exported_requires = find_exported_requires(&tree.hir, &bound, decisions);
    ParsedCodeFile {
        parse: Parse {
            hir: tree.hir,
            bound,
            is_shared: false,
        },
        specifies_esm,
        code: Box::new(code),
        payload: tree.payload,
    }
}

fn parse_options_of(
    context: &CodeLoadContext<'_, '_, '_>,
    path: &[u8],
    settings: &TranspileSettings,
) -> ParseOptions {
    let project = context.projects.governing_code(context, path);
    let is_javascript = is_javascript_file(context.host, path);
    let options = project.unwrap_or(context.options).for_parsing();
    ParseOptions {
        experimental_decorators: !is_javascript
            && (settings.experimental_decorators || settings.emits_decorator_metadata),
        module_detection: ModuleDetection::Force,
        bind: BindOptions {
            before_es2020: false,
            before_es2017: false,
            ..options.bind
        },
        ..options
    }
}

fn accept_tree<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    arena: &'s Arena,
    key: LoadKey<'r>,
    settings: &'r TranspileSettings,
    text: Cow<'static, [u8]>,
) -> AcceptedTree<'s, 'r> {
    let &CodeLoadContext {
        host,
        resolver,
        ref atoms,
        ..
    } = context;
    let path = key.path;
    let request = CodeParseRequest {
        path,
        loader: key.loader,
        options: parse_options_of(context, path, settings),
        reads_jsdoc: is_javascript_file(host, path),
        settings,
        declared_module_type: resolver.declared_module_type(path),
    };
    let ParsedCode {
        hir,
        host_values,
        payload,
    } = host.parse_code(arena, &request, &text, atoms);
    AcceptedTree {
        hir,
        text,
        host_values,
        payload,
        request,
    }
}

fn mark_as_module(hir: &mut hir::File<'_>) {
    if !hir.has_module_syntax && hir.kind != FileKind::Declaration {
        let has_import_meta = hir.rare_syntax & rare::IMPORT_META != 0
            && (hir.exprs.iter()).any(|e| matches!(e.kind, ExprKind::ImportMeta));
        hir.has_module_syntax = true;
        hir.is_forced_module = !has_import_meta;
    }
}

pub fn byte_range_of_node(hir: &hir::File<'_>, node: NodeData) -> (u32, u32) {
    let handle = match node {
        NodeData::None | NodeData::File => return (0, 0),
        NodeData::Expr(id) => return (hir::start_inside_parentheses(hir, id), hir[id].end),
        NodeData::Stmt(id) => return (hir[id].start, hir[id].loc.end),
        NodeData::Paren(id) => {
            let (_, start, end) = hir.parens[id.idx()];
            return (start, end);
        }
        NodeData::Part(part, owner) => owner.with(part),
        NodeData::Type(id) => hir.node(id),
        NodeData::Pat(id) => hir.node(id),
        NodeData::PatProp(id) => hir.node(id),
        NodeData::PatElem(id) => hir.node(id),
        NodeData::Param(id) => hir.node(id),
        NodeData::TypeParam(id) => hir.node(id),
        NodeData::Member(id) => hir.node(id),
        NodeData::Prop(id) => hir.node(id),
        NodeData::VarDecl(id) => hir.node(id),
        NodeData::Case(id) => hir.node(id),
        NodeData::EnumMember(id) => hir.node(id),
        NodeData::ImportSpec(id) => hir.node(id),
        NodeData::ExportSpec(id) => hir.node(id),
        NodeData::TupleElem(id) => hir.node(id),
        NodeData::Modifier(id) => hir.node(id),
        NodeData::Name(id) => hir.node(id),
    };
    let start = hir.start(handle);
    (start, start)
}

fn analyze<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    arena: &'s Arena,
    key: LoadKey<'r>,
    settings: &'r TranspileSettings,
    fold: &FoldInputs<'s>,
    tree: &mut AcceptedTree<'s, 'r>,
) -> (Bound<'s>, Analyzed<'s, 'r>) {
    let &CodeLoadContext {
        host,
        resolver,
        ref atoms,
        ..
    } = context;
    let path = key.path;
    let jsx = settings.jsx.with_pragmas(&tree.hir.jsx_pragmas, atoms);
    let file_jsx = jsx.as_ref().unwrap_or(&settings.jsx);
    let root = |names: &[Vec<u8>]| match file_jsx.runtime {
        JsxRuntime::Classic => names.first().map(|name| atoms.intern(name)),
        JsxRuntime::Automatic => None,
    };
    let runtime = RuntimeBindOptions {
        jsx_factory_root: root(&file_jsx.factory),
        jsx_fragment_root: root(&file_jsx.fragment),
        emits_decorator_metadata: settings.emits_decorator_metadata,
        hoists_top_level_variables: host.hoists_top_level_variables(path),
    };
    let declared_module_type = match host.is_plugin_source(path) {
        true => DeclaredModuleType::Unknown,
        false => resolver.declared_module_type(path),
    };
    let jsx_mode = jsx_mode_of(file_jsx, atoms);
    let bind = BindOptions {
        runtime: Some(runtime),
        ..tree.request.options.bind
    };
    let file = FileInputs {
        declared_module_type,
        import_meta_main: import_meta_main(context, key),
        is_library: host.is_library_file(path),
        host_values: tree.host_values,
        jsx: jsx_mode,
    };
    let (bound, analysis) = analyze_with_host(context, arena, path, bind, fold, file, tree);
    let analyzed = Analyzed {
        analysis,
        settings,
        jsx,
        jsx_mode,
        declared_module_type,
        is_package_type_module: resolver.is_package_type_module(path),
        package: resolver.enclosing_package(path),
        side_effects: resolver.declared_side_effects(path),
        is_aot_source: !is_javascript_file(host, path) && resolver.is_in_aot_package(path),
    };
    (bound, analyzed)
}

fn analyze_with_host<'s>(
    context: &CodeLoadContext<'_, 's, '_>,
    arena: &'s Arena,
    path: &[u8],
    bind: BindOptions,
    fold: &FoldInputs<'s>,
    mut file: FileInputs<'s>,
    tree: &mut AcceptedTree<'s, '_>,
) -> (Bound<'s>, FileAnalysis<'s>) {
    let &CodeLoadContext {
        host, ref atoms, ..
    } = context;
    let settings = tree.request.settings;
    let resolve = |specifier: &[u8]| resolve_macro_import(context, path, specifier);
    let mut is_transformed = false;
    loop {
        let (bound, analysis) = analyze_file(&mut tree.hir, bind, fold, file, atoms, arena);
        if bound.ran_out_of_stack {
            drop(bound);
            tree.replace_after_stack_overflow(context, arena);
            file.host_values = &[];
            return analyze_file(&mut tree.hir, bind, fold, file, atoms, arena);
        }
        if !analysis.pending_macro_calls.is_empty() {
            let request = MacroRequest {
                importer: path,
                hir: &tree.hir,
                bound: &bound,
                analysis: &analysis,
                resolve: &resolve,
            };
            let new_values = host.run_macros(arena, atoms, &request, &mut tree.payload);
            let merged = merge_host_values(file.host_values, new_values, arena);
            if merged.len() != file.host_values.len() {
                file.host_values = merged;
                continue;
            }
        }
        if !std::mem::replace(&mut is_transformed, true) {
            let mut request = TransformRequest {
                path,
                hir: &mut tree.hir,
                bound: &bound,
                analysis: &analysis,
                settings,
            };
            match host.transform_tree(arena, atoms, &mut request, &mut tree.payload) {
                TreeChange::Changed => continue,
                TreeChange::Unchanged => {}
            }
        }
        return (bound, analysis);
    }
}

fn jsx_mode_of(jsx: &JsxSettings, atoms: &Interner<'_>) -> JsxMode {
    match jsx.runtime {
        JsxRuntime::Classic => JsxMode::Classic,
        JsxRuntime::Automatic => JsxMode::Automatic(AutomaticJsx {
            runtime_specifier: atoms.intern(&jsx.runtime_specifier()),
            package_specifier: atoms.intern(&jsx.import_source),
            is_development: jsx.is_development,
        }),
    }
}

fn import_meta_main(context: &CodeLoadContext<'_, '_, '_>, key: LoadKey<'_>) -> Option<bool> {
    let (is_entry_point, count) = (context.is_entry_point(key), context.entry_points.len());
    match (is_entry_point, context.inputs.main_module, count) {
        (false, ..) | (true, MainModule::Elsewhere, _) => Some(false),
        (true, MainModule::EntryPoint, 1) => Some(true),
        (true, MainModule::EntryPoint | MainModule::EntryPointOfProcessOrWorker, _) => None,
    }
}

fn resolve_macro_import(
    context: &CodeLoadContext<'_, '_, '_>,
    importer: &[u8],
    specifier: &[u8],
) -> Option<Vec<u8>> {
    let request = CodeRequest {
        specifier,
        importer,
        directory: &context.host.directory_of(importer),
        kind: CodeImportKind::Import,
        form: CodeImportForm::Macro,
    };
    match context.host.resolve_code(&request) {
        HostResolution::Unclaimed => {}
        _ => return None,
    }
    match context.resolver.resolve_code(&request) {
        CodeResolution::File(found) if found.host_module.is_some() => None,
        CodeResolution::File(found) => Some(found.path.to_vec()),
        _ => None,
    }
}

fn merge_host_values<'s>(
    old: &'s [(ExprId, HostValue<'s>)],
    new: &'s [(ExprId, HostValue<'s>)],
    arena: &'s Arena,
) -> &'s [(ExprId, HostValue<'s>)] {
    if new.is_empty() {
        return old;
    }
    let mut merged = Vec::with_capacity(old.len() + new.len());
    let (mut old_rest, mut new_rest) = (old, new);
    while let (Some(&older), Some(&newer)) = (old_rest.first(), new_rest.first()) {
        match older.0.cmp(&newer.0) {
            Ordering::Less => {
                merged.push(older);
                old_rest = &old_rest[1..];
            }
            Ordering::Equal => new_rest = &new_rest[1..],
            Ordering::Greater => {
                merged.push(newer);
                new_rest = &new_rest[1..];
            }
        }
    }
    merged.extend_from_slice(old_rest);
    merged.extend_from_slice(new_rest);
    slice_in(&merged, arena)
}

#[cfg(test)]
mod tests;
