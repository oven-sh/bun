# Writes crate/src/checker/c02_checker_generated.rs (the Checker record with every field of checker.go 585-906) and data/checker-fields.tsv.
# Input: ../../checker-core-scratch/data/fields.tsv (line, name, Go type, proposed Rust type, line of NewChecker that sets it, layers).
# usage: python3 genchecker.py <out rs> <out tsv> [--check]
import re, subprocess, sys, tempfile, os

# The generated file is what rustfmt makes of the generator's text.
def rustfmt(text):
    fd, path = tempfile.mkstemp(suffix='.rs')
    os.write(fd, text.encode()); os.close(fd)
    subprocess.run(['rustfmt', '--edition', '2024', path], check=True)
    out = open(path).read(); os.unlink(path)
    return out

FIELDS = '/workspace/notes/lint/units/typecheck/checker-core-scratch/data/fields.tsv'

def words(name):
    name = name.replace('JSDoc', 'Jsdoc')
    name = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', name)
    return re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', name)

def snake(name):
    return words(name).lower().lstrip('_')

# Records that carry the lifetime of the lists and texts.
LIFETIME = ['TypeAliasLinks', 'ModuleSymbolLinks', 'DeferredSymbolLinks', 'SwitchStatementLinks', 'VarianceLinks',
            'ContainingSymbolLinks', 'TypeNodeLinks', 'ComputedNameNodeLinks', 'EnumMemberLinks', 'SourceFileLinks',
            'VarianceStackEntry', 'EnumLiteralKey', 'PseudoBigInt', 'PatternAmbientModule']

# name -> (Rust type or None when the field has no port, note). A type of None drops the field.
OVERRIDES = {
    'program': ("&'a dyn Program<'a>", 'constructor argument'),
    'compilerOptions': ("&'a CompilerOptions", 'constructor argument'),
    'files': ("List<'a, NodeId>", 'the SourceFile nodes in program order'),
    'compareSymbols': (None, 'method compare_symbols calls compare_symbols_worker'),
    'compareSymbolChains': (None, 'method compare_symbol_chains calls compare_symbol_chains_worker'),
    'languageVersion': ('ScriptTarget', ''),
    'moduleKind': ('ModuleKind', ''),
    'moduleResolutionKind': ('ModuleResolutionKind', ''),
    'arrayVariances': ("List<'a, VarianceFlags>", ''),
    'evaluate': (None, 'method evaluate runs the evaluator with evaluate_entity as host'),
    'stringLiteralTypes': ("Map<Text<'a>, TypeId>", ''),
    'numberLiteralTypes': ('Map<u64, TypeId>', 'the key is the bit pattern, -0 stored as +0; NaN has nan_type'),
    'bigintLiteralTypes': ("Map<PseudoBigInt<'a>, TypeId>", ''),
    'enumLiteralTypes': ("Map<EnumLiteralKey<'a>, TypeId>", ''),
    'thisExpandoKinds': ('Map<SymbolId, ThisAssignmentDeclarationKind>', ''),
    'subtypeReductionCache': ("Map<CacheHashKey, List<'a, TypeId>>", ''),
    'undefinedProperties': ("Map<Text<'a>, SymbolId>", ''),
    'unresolvedSymbols': ("Map<Text<'a>, SymbolId>", ''),
    'symbolTableAliasCache': ("Map<SymbolTableKey, List<'a, SymbolId>>", ''),
    'resolveName': (None, 'method resolve_name runs NameResolver::resolve with the host of createNameResolver'),
    'resolveNameForSymbolSuggestion': (None, 'method resolve_name_for_symbol_suggestion, host of createNameResolverForSuggestion'),
    'diagnostics': ('DiagnosticsCollection', 'over the one store `diagnostic_store`'),
    'suggestionDiagnostics': ('DiagnosticsCollection', 'over the one store `diagnostic_store`'),
    'symbolArena': (None, 'the symbols of a checker live in the open store of the node table (ast.new_symbol)'),
    'signatureArena': ("Records<SignatureId, Signature<'a>>", 'field `signatures`'),
    'indexInfoArena': ("Records<IndexInfoId, IndexInfo<'a>>", 'field `index_infos`'),
    'factory': (None, 'synthetic nodes are made in the open store of the node table'),
    'valueSymbolLinks': ('LinkStore<SymbolId, ValueSymbolLinks>', 'every access goes through value_symbol_links_get, which assigns the lazy symbol id (links.go 34, 46)'),
    'symbolNodeLinks': ('LinkStore<NodeId, SymbolNodeLinks>', 'the paged store is an allocation detail'),
    'regExpScanner': (None, 'made on first use by the regular expression layer'),
    'patternAmbientModules': ("Vec<PatternAmbientModule<'a>>", ''),
    'apparentArgumentCount': ('Option<isize>', '`*int`'),
    'freeinferenceState': ('InferenceStateId', 'head of the free list in inference_states'),
    'freeFlowState': ('FlowStateId', 'head of the free list in flow_states'),
    'freeRelater': ('RelaterId', 'head of the free list in relaters'),
    'getGlobalClassAccessorDecoratorContxtType': (None, 'never assigned and never read upstream'),
    'syncIterationTypesResolver': (None, 'IterationTypesResolverKind::Sync: the function fields are methods that switch on the kind'),
    'asyncIterationTypesResolver': (None, 'IterationTypesResolverKind::Async'),
    'isPrimitiveOrObjectOrEmptyType': (None, 'method'),
    'containsMissingType': (None, 'method'),
    'couldContainTypeVariables': (None, 'method could_contain_type_variables calls could_contain_type_variables_worker'),
    'isStringIndexSignatureOnlyType': (None, 'method'),
    'markNodeAssignments': (None, 'method'),
    'compareTypesAssignable': (None, 'TypeComparer::Assignable and method compare_types_assignable_worker'),
    'emitResolver': (None, 'declaration emit is out of scope'),
    'emitResolverOnce': (None, 'declaration emit is out of scope'),
    'ctx': (None, 'no cancellation: one checker, one run'),
    'packagesMap': ("Map<Text<'a>, bool>", ''),
    'ambientModulesOnce': (None, 'folded into the Memo of ambient_modules'),
    'ambientModules': ("Memo<List<'a, SymbolId>>", ''),
    'deferredDiagnosticCallbacks': ("Vec<DeferredDiagnosticCallback<'a>>", 'boxed FnOnce(&mut Checker)'),
    'typeToStringNodebuilder': (None, 'field `node_builder`: the state of the one node builder; its handle is the unit value NodeBuilder'),
    'mu': (None, 'one checker'),
    'tracer': (None, 'tracing has no port'),
    '_jsxNamespace': ("Text<'a>", ''),
    'lastGetCombinedNodeFlagsResult': ('NodeFlags', ''),
    'lastGetCombinedModifierFlagsResult': ('ModifierFlags', ''),
    'flowLoopStack': ('Vec<FlowLoopInfo>', ''),
}
RENAMES = {'signatureArena': 'signatures', 'indexInfoArena': 'index_infos'}

def rust_type(name, proposed):
    if name in OVERRIDES:
        return OVERRIDES[name]
    t = proposed
    for n in LIFETIME:
        t = re.sub(r'\b' + n + r'\b(?!<)', n + "<'a>", t)
    if re.search(r"[\[\]*() ]", t.replace(', ', ',')) or '.' in t or t in ('method',):
        return ('?' + t, 'no mapping')
    return (t, '')

def generate():
    rows = [l.rstrip('\n').split('\t') for l in open(FIELDS) if l.count('\t') == 5]
    out, table, problems = [], [], []
    out.append('// Generated by py/genchecker.py from the Checker struct of checker.go 585-906 (typescript-go 89d5d5b). Do not edit.')
    out.append('use crate::ast::flags_generated::{ModifierFlags, NodeFlags};')
    out.append('use crate::ast::reader::Ast;')
    out.append('use crate::checker::arena::CheckerArena;')
    out.append('use crate::checker::c01_data::*;')
    out.append('use crate::checker::checker::DeferredDiagnosticCallback;')
    out.append('use crate::checker::flags_generated::{ExpandingFlags, RelationComparisonResult, VarianceFlags};')
    out.append('use crate::checker::c30_type_keys::CacheHashKey;')
    out.append('use crate::checker::mapper::TypeMapper;')
    out.append('use crate::checker::nodebuilder::NodeBuilderState;')
    out.append('use crate::checker::standins::Scripted;')
    out.append('use crate::checker::program::{CompilerOptions, ModuleKind, ModuleResolutionKind, Program, ScriptTarget};')
    out.append('use crate::checker::types::*;')
    out.append('use crate::ast_diagnostic::{DiagnosticStore, DiagnosticsCollection};')
    out.append('use crate::tscore::deps::StackCheck;')
    out.append('use crate::tscore::golang::{List, Map, Memo, Set, Text};')
    out.append('use crate::tscore::ids::*;')
    out.append('use crate::tscore::internal::StandIns;')
    out.append('use crate::tscore::linkstore::LinkStore;')
    out.append('use crate::tscore::records::Records;')
    out.append('')
    out.append("pub struct Checker<'a> {")
    out.append('    // What the port adds: the node table, the arena of the lists, the stores of the records and the sinks. `scripted` is of the scratch only.')
    extra = [
        ('ast', "Ast<'a>"), ('lists', "&'a CheckerArena<'a>"), ('stack_check', 'StackCheck'), ('stand_ins', 'StandIns'),
        ('types', "Records<TypeId, Type<'a>>"), ('type_mappers', "Records<TypeMapperId, TypeMapper<'a>>"),
        ('type_aliases', "Records<TypeAliasId, TypeAlias<'a>>"), ('type_predicates', "Records<TypePredicateId, TypePredicate<'a>>"),
        ('conditional_roots', "Records<ConditionalRootId, ConditionalRoot<'a>>"),
        ('composite_signatures', "Records<CompositeSignatureId, CompositeSignature<'a>>"),
        ('widening_contexts', "Records<WideningContextId, WideningContext<'a>>"),
        ('inference_contexts', "Records<InferenceContextId, InferenceContext<'a>>"),
        ('inference_infos', 'Records<InferenceInfoId, InferenceInfo>'),
        ('inference_states', "Records<InferenceStateId, InferenceState<'a>>"),
        ('relaters', "Records<RelaterId, Relater<'a>>"), ('flow_states', 'Records<FlowStateId, FlowState>'),
        ('nil_sections', "NilSections<'a>"), ('sink_sections', "NilSections<'a>"),
        ('nil_cache', 'Map<CacheHashKey, TypeId>'), ('active_type_mappers_caches_len', 'usize'),
        ('diagnostic_store', 'DiagnosticStore'), ('node_builder', 'NodeBuilderState'), ('scripted', 'Scripted'),
    ]
    params = {'ast', 'lists'}
    names = []
    for n, t in extra:
        out.append(f'    pub {n}: {t},')
        names.append(n)
    out.append('    // The fields of upstream, in upstream order.')
    for line, name, gotype, proposed, init, layers in rows:
        t, note = rust_type(name, proposed)
        field = RENAMES.get(name, snake(name))
        if t is None:
            table.append((line, name, gotype, '-', '-', note))
            continue
        if t.startswith('?'):
            problems.append(f'{name}: {gotype} -> {t[1:]}')
            table.append((line, name, gotype, field, t, 'NO MAPPING'))
            continue
        if field in names:
            problems.append(f'{name}: duplicate field {field}')
        names.append(field)
        if name in ('program', 'compilerOptions'):
            params.add(field)
        out.append(f'    pub {field}: {t},')
        table.append((line, name, gotype, field, t, note))
    out.append('}')
    out.append('')
    out.append("impl<'a> Checker<'a> {")
    out.append("    // `c := &Checker{}`: every field is its zero value. NewChecker fills them in.")
    out.append("    pub fn zero(")
    out.append("        ast: Ast<'a>,")
    out.append("        lists: &'a CheckerArena<'a>,")
    out.append("        program: &'a dyn Program<'a>,")
    out.append("        compiler_options: &'a CompilerOptions,")
    out.append("    ) -> Self {")
    out.append('        Self {')
    for n in names:
        if n in params:
            out.append(f'            {n},')
        else:
            out.append(f'            {n}: Default::default(),')
    out.append('        }')
    out.append('    }')
    out.append('}')
    return rustfmt('\n'.join(out) + '\n'), table, problems

if __name__ == '__main__':
    out_rs, out_tsv = sys.argv[1], sys.argv[2]
    text, table, problems = generate()
    tsv = 'line\tupstream field\tGo type\tRust field\tRust type\tnote\n' + ''.join('\t'.join(r) + '\n' for r in table)
    for p in problems:
        print('problem:', p)
    kept = sum(1 for r in table if r[3] != '-')
    if '--check' in sys.argv:
        ok = open(out_rs).read() == text and open(out_tsv).read() == tsv
        print('checker record:', 'no diff' if ok else 'DIFFERS', f'{len(table)} upstream fields, {kept} ported, {len(table) - kept} without a field')
        sys.exit(0 if ok and not problems else 1)
    open(out_rs, 'w').write(text)
    open(out_tsv, 'w').write(tsv)
    print(f'wrote {out_rs}: {len(table)} upstream fields, {kept} ported, {len(table) - kept} without a field, {len(problems)} problems')
    sys.exit(1 if problems else 0)
