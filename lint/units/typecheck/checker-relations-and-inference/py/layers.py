# Layers of relater.go and inference.go, by line range of the declaration, and the tables derived from the call graph.
# Input: fns.json made by ../checker-core-scratch/run.sh (default /tmp/k3a/fns.json).
# usage: layers.py <fns.json> funcs|standins_in|standins_out|rows|summary|panics|diags
import json, sys, collections

LAYERS = [
    # (layer, file, first line, last line)
    ('R-REL',      'checker/relater.go', 1, 422),
    ('R-ELAB',     'checker/relater.go', 424, 675),
    ('R-REL',      'checker/relater.go', 677, 870),
    ('R-DISCRIM',  'checker/relater.go', 872, 950),
    ('R-REL',      'checker/relater.go', 952, 1028),
    ('R-DISCRIM',  'checker/relater.go', 1030, 1268),
    ('R-REL',      'checker/relater.go', 1270, 1315),
    ('R-VARIANCE', 'checker/relater.go', 1317, 1485),
    ('R-SIGREL',   'checker/relater.go', 1487, 2313),
    ('R-REL',      'checker/relater.go', 2315, 2557),
    ('R-SIGREL',   'checker/relater.go', 2559, 2567),
    ('R-REL',      'checker/relater.go', 2569, 3933),
    ('R-VARIANCE', 'checker/relater.go', 3935, 3999),
    ('R-REL',      'checker/relater.go', 4001, 4019),
    ('R-DISCRIM',  'checker/relater.go', 4021, 4130),
    ('R-REL',      'checker/relater.go', 4132, 4471),
    ('R-SIGREL',   'checker/relater.go', 4473, 4608),
    ('R-REL',      'checker/relater.go', 4610, 5044),
    ('I-INFER',    'checker/inference.go', 1, 998),
    ('I-REVMAP',   'checker/inference.go', 1000, 1183),
    ('I-INFER',    'checker/inference.go', 1185, 1684),
]

# Sections of checker.go as ../checker-core-scratch/data/split.tsv names them.
SPLIT = [
 (1, 'c01_data'), (553, 'c02_program_checker'), (908, 'c03_init'), (1505, 'c04_name_resolution_hooks'),
 (2202, 'c05_check_source_file'), (2662, 'c06_check_members_type_nodes'), (3412, 'c07_check_functions'),
 (3793, 'c08_check_statements'), (4286, 'c09_check_classes_interfaces'), (5148, 'c10_check_enums_modules_imports'),
 (5854, 'c11_check_variables_decorators'), (6185, 'c12_iteration_types'), (6826, 'c13_check_aliases_unused'),
 (7419, 'c14_expressions'), (8407, 'c15_calls'), (10133, 'c16_function_expressions_collisions'),
 (10707, 'c17_unary_meta_yield'), (11132, 'c18_identifiers_property_access_this'),
 (12378, 'c19_assertions_binary_operators'), (13235, 'c20_object_literals_spread'),
 (13991, 'c21_resolved_symbols_diagnostics'), (14170, 'c22_symbols_merge'), (14533, 'c23_alias_targets'),
 (15195, 'c24_external_modules'), (15830, 'c25_entity_names'), (16014, 'c26_exports_late_binding'),
 (16349, 'c27_resolve_alias'), (16495, 'c28_types_of_symbols'), (17141, 'c29_constraints'),
 (17471, 'c30_type_keys'), (17777, 'c31_binding_patterns_widening'), (18861, 'c32_type_resolution'),
 (18960, 'c33_members_base_types_signatures'), (20115, 'c34_return_types'), (20729, 'c35_resolve_members'),
 (21513, 'c36_properties_apparent_types'), (22214, 'c37_instantiation'), (22913, 'c38_type_nodes_references'),
 (23878, 'c39_declared_types_enums'), (24225, 'c40_type_nodes_conditional_tuples'), (25126, 'c41_new_types'),
 (25396, 'c42_literal_types'), (25725, 'c43_unions_intersections'), (26803, 'c44_index_indexed_access'),
 (27551, 'c45_base_constraints_normalization'), (28312, 'c46_mark_references'),
 (29042, 'c47_promised_mapped_template'), (29449, 'c48_contextual_types'),
 (30164, 'c49_call_arguments_decorator_signatures'), (30674, 'c50_contextual_properties_inference_context'),
 (31097, 'c51_type_facts_awaited'), (31704, 'c52_symbol_at_location'),
]

# Sections and files that the order of typecheck.md puts AFTER relations (relater.go): a callee there is a stand-in when R-* lands.
AFTER_RELATIONS = set('''c05_check_source_file c06_check_members_type_nodes c07_check_functions c08_check_statements
c09_check_classes_interfaces c10_check_enums_modules_imports c11_check_variables_decorators c12_iteration_types
c13_check_aliases_unused c14_expressions c15_calls c16_function_expressions_collisions c17_unary_meta_yield
c18_identifiers_property_access_this c19_assertions_binary_operators c20_object_literals_spread
c44_index_indexed_access c46_mark_references c47_promised_mapped_template c48_contextual_types
c49_call_arguments_decorator_signatures c50_contextual_properties_inference_context c51_type_facts_awaited
c52_symbol_at_location flow.go jsx.go grammarchecks.go inference.go jsdoc.go exports.go services.go emitresolver.go'''.split())
# Sections that the same order puts after inference (inference.go): a callee there is a stand-in when I-* lands.
AFTER_INFERENCE = set('''c05_check_source_file c06_check_members_type_nodes c08_check_statements
c09_check_classes_interfaces c10_check_enums_modules_imports c11_check_variables_decorators c12_iteration_types
c13_check_aliases_unused c44_index_indexed_access c46_mark_references c47_promised_mapped_template c48_contextual_types
c50_contextual_properties_inference_context c52_symbol_at_location flow.go jsx.go grammarchecks.go jsdoc.go exports.go
services.go emitresolver.go'''.split())

def module_of(f):
    file = f['file']
    if file == 'checker/checker.go':
        name = SPLIT[0][1]
        for start, n in SPLIT:
            if f['decl'] >= start: name = n
        return name
    return file.split('/')[-1] if file.startswith('checker/') else file

def layer_of(f):
    for name, file, lo, hi in LAYERS:
        if f['file'] == file and lo <= f['decl'] <= hi:
            return name
    return None

def load(path):
    fns = json.load(open(path))
    for f in fns:
        for k in ('callees', 'diags', 'panics', 'asserts', 'maprange', 'program', 'tracer', 'symw', 'links', 'fields'):
            if f.get(k) is None: f[k] = []
        f['layer'] = layer_of(f)
        f['module'] = module_of(f)
    return fns

def short(n):
    return n.replace('checker.Checker.', 'c.').replace('checker.Relater.', 'r.').replace('checker.', '')

def loc(f):
    return f"{f['file'].split('/')[-1]}:{f['decl']}-{f['end']}"

ORDER = ['R-REL', 'R-SIGREL', 'R-VARIANCE', 'R-DISCRIM', 'R-ELAB', 'I-INFER', 'I-REVMAP']

def main():
    fns = load(sys.argv[1])
    mode = sys.argv[2]
    byname = {}
    for f in fns: byname.setdefault(f['name'], f)
    mine = sorted([f for f in fns if f['layer']], key=lambda f: (f['file'] != 'checker/relater.go', f['decl']))
    if mode == 'summary':
        for L in ORDER:
            fs = [f for f in mine if f['layer'] == L]
            print(L, 'functions', len(fs), 'lines', sum(f['end'] - f['start'] + 1 for f in fs),
                  'closures', sum(f['closures'] for f in fs), 'diag refs', sum(len(f['diags']) for f in fs),
                  'panics', sum(len(f['panics']) for f in fs))
    if mode == 'funcs':
        print('layer\tfile\tlines\tfunction\tclosures\tcodes\tpanic lines')
        codes = json.load(open(sys.argv[3]))['codes'] if len(sys.argv) > 3 else {}
        for f in mine:
            d = sorted(set(str(codes[n][0]) if n in codes else n for n in f['diags']), key=lambda x: (len(x), x))
            print(f"{f['layer']}\t{f['file'].split('/')[-1]}\t{f['start']}-{f['end']}\t{short(f['name'])}\t{f['closures']}\t{','.join(d)}\t{','.join(str(p['line']) for p in f['panics'])}")
    if mode == 'standins_in':
        # callees outside relater.go and inference.go, per layer
        print('layer\tcallee\twhere\tmodule\tafter relations\tafter inference\tcallers in the layer')
        for L in ORDER:
            out = collections.OrderedDict()
            for f in mine:
                if f['layer'] != L: continue
                for cal in f['callees']:
                    if not (cal.startswith('checker.') or cal.startswith('binder.')): continue
                    t = byname.get(cal)
                    if t is None or t['layer']: continue
                    out.setdefault(cal, []).append(short(f['name']))
            for cal in sorted(out, key=lambda n: (byname[n]['file'], byname[n]['decl'])):
                t = byname[cal]
                print(f"{L}\t{short(cal)}\t{loc(t)}\t{t['module']}\t{'yes' if t['module'] in AFTER_RELATIONS else ''}\t{'yes' if t['module'] in AFTER_INFERENCE else ''}\t{', '.join(sorted(set(out[cal])))}")
    if mode == 'cross':
        # calls between the seven layers
        print('from\tto\tcallee\twhere\tcallers')
        for L in ORDER:
            out = collections.OrderedDict()
            for f in mine:
                if f['layer'] != L: continue
                for cal in f['callees']:
                    t = byname.get(cal)
                    if t is None or not t['layer'] or t['layer'] == L: continue
                    out.setdefault(cal, []).append(short(f['name']))
            for cal in sorted(out, key=lambda n: (ORDER.index(byname[n]['layer']), byname[n]['file'], byname[n]['decl'])):
                t = byname[cal]
                print(f"{L}\t{t['layer']}\t{short(cal)}\t{loc(t)}\t{', '.join(sorted(set(out[cal])))}")
    if mode == 'standins_out':
        # functions of the layers that code outside the two files calls
        print('layer\tfunction\twhere\tcaller module\tcallers')
        callers = collections.defaultdict(lambda: collections.defaultdict(list))
        for f in fns:
            if f['layer']: continue
            for cal in f['callees']:
                t = byname.get(cal)
                if t is not None and t['layer']:
                    callers[cal][f['module']].append(short(f['name']))
        for L in ORDER:
            for f in mine:
                if f['layer'] != L or f['name'] not in callers: continue
                for m in sorted(callers[f['name']]):
                    print(f"{L}\t{short(f['name'])}\t{loc(f)}\t{m}\t{', '.join(sorted(set(callers[f['name']][m])))}")
    if mode == 'panics':
        for f in mine:
            for p in f['panics']:
                print(f"{f['layer']}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f['name'])}\tpanic\t{p['text']}")
            for p in f['asserts']:
                print(f"{f['layer']}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f['name'])}\tassert\t{p['text']}")
    if mode == 'rows':
        print('upstream path\tlines\tgroup\tRust module\tstate\tcommit')
        for i, (L, file, lo, hi) in enumerate(LAYERS):
            fs = [f for f in mine if f['file'] == file and lo <= f['decl'] <= hi]
            base = 'relater' if file.endswith('relater.go') else 'inference'
            names = short(fs[0]['name']) + ' .. ' + short(fs[-1]['name']) if len(fs) > 1 else (short(fs[0]['name']) if fs else 'types and constants')
            print(f"internal/{file}\t{lo}-{hi}\t{L}: {names} ({len(fs)} functions)\tchecker/{base}/r{i+1:02d}.rs\tnot started\t89d5d5b")

main()
