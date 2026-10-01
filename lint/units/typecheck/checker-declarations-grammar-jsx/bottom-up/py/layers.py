# Layers of the declaration checks, grammar checks, JSX and the service boundary, by line range of the declaration.
# Input: fns.json made by ../../checker-core-scratch/run.sh (default /tmp/k3a/fns.json, copied to /tmp/cdg/fns.json).
# usage: layers.py <fns.json> summary|funcs|cross|in|out|panics|diags|rows
import json, sys, collections, re

C = 'checker/checker.go'
LAYERS = [
    # (layer, file, first line, last line)
    ('D-DRIVER',    C, 2202, 2545),
    ('D-JSDOC',     C, 2547, 2609),
    ('D-TYPENODE',  C, 2611, 2660),
    ('D-FUNC',      C, 2662, 2988),
    ('D-TYPENODE',  C, 2990, 3410),
    ('D-FUNC',      C, 3412, 3791),
    ('D-STMT',      C, 3793, 4284),
    ('D-CLASS',     C, 4286, 5146),
    ('D-ENUMNS',    C, 5148, 5342),
    ('D-IMPEXP',    C, 5344, 5852),
    ('D-VAR',       C, 5854, 6110),
    ('D-DECOR',     C, 6112, 6183),
    ('D-ITER',      C, 6185, 6824),
    ('D-IMPEXP',    C, 6826, 6964),
    ('D-TYPENODE',  C, 6966, 6998),
    ('D-IMPEXP',    C, 7000, 7090),
    ('D-TYPENODE',  C, 7092, 7128),
    ('D-UNUSED',    C, 7130, 7417),
    ('E-DECOR',     C, 8833, 8888),
    ('E-DECOR',     C, 9273, 9302),
    ('D-HELPERS',   C, 10171, 10197),
    ('E-COLLIDE',   C, 10534, 10705),
    ('E-AWAIT',     C, 10935, 10943),
    ('T-JSDECL',    C, 18151, 18350),
    ('U-ALIASMARK', C, 28312, 28697),
    ('D-HELPERS',   C, 28699, 28807),
    ('U-ALIASMARK', C, 28809, 29040),
    ('E-AWAIT',     C, 29042, 29133),
    ('E-DECOR',     C, 29924, 29930),
    ('E-DECOR',     C, 30265, 30672),
    ('E-AWAIT',     C, 31355, 31591),
    ('Z-SERVICES',  C, 31704, 32296),
    ('G-GRAMMAR',   'checker/grammarchecks.go', 1, 99999),
    ('X-JSX',       'checker/jsx.go', 1, 99999),
    ('D-JSDOC',     'checker/jsdoc.go', 1, 99999),
    ('Z-SERVICES',  'checker/services.go', 1, 99999),
    ('Z-SERVICES',  'checker/emitresolver.go', 1, 99999),
    ('Z-SERVICES',  'checker/exports.go', 1, 99999),
]
ORDER = ['D-DRIVER', 'D-TYPENODE', 'D-VAR', 'D-FUNC', 'D-STMT', 'D-CLASS', 'D-ENUMNS', 'D-IMPEXP', 'U-ALIASMARK', 'D-UNUSED',
         'D-ITER', 'E-AWAIT', 'D-DECOR', 'E-DECOR', 'D-HELPERS', 'E-COLLIDE', 'G-GRAMMAR', 'X-JSX', 'D-JSDOC', 'T-JSDECL', 'Z-SERVICES']

# Sections of checker.go as ../../checker-core-scratch/data/split.tsv names them.
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

def module_of(f):
    file = f['file']
    if file == C:
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
    return n.replace('checker.Checker.', 'c.').replace('checker.', '')

def loc(f):
    return f"{f['file'].split('/')[-1]}:{f['decl']}-{f['end']}"

def load_codes():
    codes = {}
    for line in open('/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go'):
        m = re.match(r'var (\w+) = &Message\{code: (\d+), category: Category(\w+),', line)
        if m: codes[m.group(1)] = (int(m.group(2)), m.group(3))
    return codes

def main():
    fns = load(sys.argv[1])
    mode = sys.argv[2]
    codes = load_codes()
    byname = {}
    for f in fns: byname.setdefault(f['name'], f)
    key = lambda f: (f['file'], f['decl'])
    mine = sorted([f for f in fns if f['layer']], key=key)
    if mode == 'summary':
        tot = [0, 0]
        for L in ORDER:
            fs = [f for f in mine if f['layer'] == L]
            n = sum(f['end'] - f['decl'] + 1 for f in fs)
            tot[0] += len(fs); tot[1] += n
            print(L, 'functions', len(fs), 'lines', n,
                  'closures', sum(f['closures'] for f in fs), 'diag refs', sum(len(f['diags']) for f in fs),
                  'panics', sum(len(f['panics']) + len(f['asserts']) for f in fs))
        print('total', tot)
    if mode == 'funcs':
        print('layer\tfile\tlines\tfunction\tclosures\tcodes\tpanic lines\tassert lines\tprogram\tmaprange')
        for L in ORDER:
            for f in mine:
                if f['layer'] != L: continue
                d = sorted(set(str(codes[n][0]) if n in codes else n for n in f['diags']), key=lambda x: (len(x), x))
                print(f"{f['layer']}\t{f['file'].split('/')[-1]}\t{f['decl']}-{f['end']}\t{short(f['name'])}\t{f['closures']}\t{','.join(d)}\t{','.join(str(p['line']) for p in f['panics'])}\t{','.join(str(p['line']) for p in f['asserts'])}\t{','.join(sorted(set(p['text'] for p in f['program'])))}\t{','.join(str(p['line']) for p in f['maprange'])}")
    if mode == 'out':
        # callees outside the layers of this table, per layer, grouped by module
        print('layer\tcallee\twhere\tmodule\tcallers in the layer')
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
                print(f"{L}\t{short(cal)}\t{loc(t)}\t{t['module']}\t{', '.join(sorted(set(out[cal])))}")
    if mode == 'cross':
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
    if mode == 'in':
        # functions of the layers that code outside the layers calls
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
        print('layer\twhere\tfunction\tkind\ttext')
        for L in ORDER:
            for f in mine:
                if f['layer'] != L: continue
                for p in f['panics']:
                    print(f"{f['layer']}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f['name'])}\tpanic\t{p['text']}")
                for p in f['asserts']:
                    print(f"{f['layer']}\t{f['file'].split('/')[-1]}:{p['line']}\t{short(f['name'])}\tassert\t{p['text']}")
    if mode == 'diags':
        print('layer\tcode\tcategory\tmessage\tfunctions')
        for L in ORDER:
            agg = collections.OrderedDict()
            for f in mine:
                if f['layer'] != L: continue
                for n in f['diags']:
                    agg.setdefault(n, []).append(short(f['name']))
            for n in sorted(agg, key=lambda n: codes.get(n, (0, ''))[0]):
                c = codes.get(n, (0, '?'))
                print(f"{L}\t{c[0]}\t{c[1]}\t{n}\t{', '.join(sorted(set(agg[n])))}")
    if mode == 'nocaller':
        called = set()
        for f in fns:
            for cal in f['callees']:
                if cal != f['name']: called.add(cal)
        for f in mine:
            if f['name'] not in called:
                print(f"{f['layer']}\t{loc(f)}\t{short(f['name'])}")

main()
