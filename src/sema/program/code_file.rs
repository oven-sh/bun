use super::code_barrels::summarize_requests;
use super::code_imports::resolve_code_imports;
use super::code_load::{Analyzed, CodeTarget, LoadKey, ParsedCodeFile};
use super::*;
use crate::bind::{BindOptions, RuntimeBindOptions};
use crate::erasure::{Erasure, ErasureMismatchKind, check_erasure_with_ranges};
use crate::file_analysis::{FileAnalysis, FileInputs, analyze_file};
use crate::fold::FoldInputs;
use crate::hir_from_data::HostValue;
use crate::import_sites::{AutomaticJsx, JsxMode};
use crate::module_format::DeclaredModuleType;
use crate::resolve::{
    CodeImportForm, CodeImportKind, CodeParseRequest, CodeRead, CodeRequest, CodeResolution,
    HostPayload, HostResolution, JsxRuntime, JsxSettings, MacroRequest, ParsedCode,
    TransformRequest, TranspileSettings, TreeChange, TypedVersionOrigin,
};
use std::cmp::Ordering;

struct AcceptedTree<'s, 'r> {
    hir: hir::File<'s>,
    text: Cow<'static, [u8]>,
    host_values: &'s [(ExprId, HostValue<'s>)],
    payload: Option<HostPayload>,
    request: CodeParseRequest<'r>,
    typed_source_path: Option<&'r [u8]>,
    installed_text: Option<InstalledText<'s>>,
    rejected_typed_version: Option<RejectedTypedVersion<'r>>,
    typed_version_origin: Option<TypedVersionOrigin>,
}

#[derive(Copy, Clone)]
struct AnalysisInputs<'a, 's> {
    bind: BindOptions,
    fold: &'a FoldInputs<'s>,
    file: FileInputs<'s>,
    settings: &'a TranspileSettings,
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
            is_typed_version: self.hir.is_typed_version,
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
    let (bound, analyzed) = analyze(context, arena, key, settings, &mut tree);
    // `transform_tree` reads the comments that turn the React Compiler off.
    if !tree.request.options.keeps_comments {
        tree.hir.comments = Default::default();
    }
    rename_private_names_with(&mut tree.hir, &bound, atoms, path, |reference, _| {
        bound.runtime.private_class(reference)
    });
    let mut code = resolve_code_imports(context, key, &tree.hir, analyzed);
    code.add_implied(context, key, &tree.hir, &bound, &mut tree.payload);
    code.requests = summarize_requests(context, key, &tree.hir, &bound, &code);
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
        // A default value stays in front of the body: nothing is rewritten for an older engine.
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
    let can_have_typed_version =
        key.loader == HostLoader::default() && is_javascript_file(host, path);
    let typed_version = match can_have_typed_version {
        true => resolver.typed_version_of(path),
        false => None,
    };
    let (missing, typed_version) = match typed_version {
        Some(typed) if typed.is_missing => (Some(typed), None),
        typed_version => (None, typed_version),
    };
    let typed = typed_version.and_then(|typed| match host.read_code(typed.path) {
        CodeRead::Text(typed_text) => Some((typed, typed_text)),
        CodeRead::Deferred => None,
    });
    let mut rejected_typed_version = missing.map(|typed| RejectedTypedVersion {
        path: typed.path,
        kind: ErasureMismatchKind::Missing,
        installed_range: (0, 0),
    });
    let mut typed_version_origin = None;
    if let Some((typed, typed_text)) = typed {
        typed_version_origin = Some(typed.origin);
        let typed_request = CodeParseRequest {
            path: typed.path,
            reads_jsdoc: is_javascript_file(host, typed.path),
            ..request
        };
        let mut typed_code = host.parse_code(arena, &typed_request, &typed_text, atoms);
        typed_code.hir.is_typed_version = true;
        let erasure_request = CodeParseRequest {
            reads_jsdoc: false,
            ..request
        };
        let installed = host.parse_code(arena, &erasure_request, &text, atoms);
        let (erasure, ranges) = check_erasure_with_ranges(&typed_code.hir, &installed.hir);
        let (kind, installed_node) = match erasure {
            Erasure::Exact if typed_code.hir.kind != FileKind::Declaration => {
                return AcceptedTree {
                    hir: typed_code.hir,
                    text: typed_text,
                    host_values: typed_code.host_values,
                    payload: typed_code.payload,
                    request: typed_request,
                    typed_source_path: Some(typed.path),
                    installed_text: Some(InstalledText {
                        text: slice_in(&text[..], arena),
                        functions: slice_in(&ranges.functions, arena),
                        classes: slice_in(&ranges.classes, arena),
                        token_offsets: slice_in(&ranges.token_offsets, arena),
                    }),
                    rejected_typed_version: None,
                    typed_version_origin,
                };
            }
            Erasure::Mismatch(mismatch) => (mismatch.kind, mismatch.untyped),
            Erasure::Exact | Erasure::Unknown => (ErasureMismatchKind::NodeKind, NodeData::File),
        };
        rejected_typed_version = Some(RejectedTypedVersion {
            path: typed.path,
            kind,
            installed_range: byte_range_of_node(&installed.hir, installed_node),
        });
    }
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
        typed_source_path: None,
        installed_text: None,
        rejected_typed_version,
        typed_version_origin,
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
    let inputs = AnalysisInputs {
        bind: BindOptions {
            runtime: Some(runtime),
            ..tree.request.options.bind
        },
        fold: context.inputs.fold,
        file: FileInputs {
            declared_module_type,
            import_meta_main: import_meta_main(context, key),
            is_library: host.is_library_file(path),
            host_values: tree.host_values,
            jsx: jsx_mode,
        },
        settings,
    };
    let (bound, analysis) = analyze_with_host(context, arena, path, inputs, tree);
    let analyzed = Analyzed {
        analysis,
        settings,
        jsx,
        jsx_mode,
        declared_module_type,
        is_package_type_module: resolver.is_package_type_module(path),
        package: resolver.enclosing_package(path),
        side_effects: resolver.declared_side_effects(path),
        typed_source_path: tree.typed_source_path,
        installed_text: tree.installed_text,
        rejected_typed_version: tree.rejected_typed_version,
        typed_version_origin: tree.typed_version_origin,
    };
    (bound, analyzed)
}

#[allow(clippy::large_types_passed_by_value)] // taken apart at once
fn analyze_with_host<'s>(
    context: &CodeLoadContext<'_, 's, '_>,
    arena: &'s Arena,
    path: &[u8],
    inputs: AnalysisInputs<'_, 's>,
    tree: &mut AcceptedTree<'s, '_>,
) -> (Bound<'s>, FileAnalysis<'s>) {
    let &CodeLoadContext {
        host, ref atoms, ..
    } = context;
    let AnalysisInputs {
        bind,
        fold,
        mut file,
        settings,
    } = inputs;
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
    let entry_points = &context.entry_points;
    let is_entry_point = entry_points.iter().any(|entry_point| {
        entry_point.key.loader == key.loader
            && is_same_path(entry_point.key.path, key.path, context.is_case_sensitive)
    });
    match (
        is_entry_point && context.inputs.has_main_module,
        entry_points.len(),
    ) {
        (false, _) => Some(false),
        (true, 1) => Some(true),
        (true, _) => None,
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
