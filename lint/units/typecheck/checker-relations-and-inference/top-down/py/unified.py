# Unified layer map: core layers, type layers, printer, and the seven layers of relations and inference.
# Input: /tmp/k3a/fns.json (call graph of checker and binder made by ../checker-core-scratch/goanal).
import json, sys, collections, re
C = 'checker/checker.go'; R = 'checker/relater.go'; I = 'checker/inference.go'
CORE = [
 ('MAPPER', 'checker/mapper.go', 1, 99999), ('UTIL', 'checker/utilities.go', 1, 99999),
 ('LINKS', 'checker/links.go', 1, 99999), ('TYPES', 'checker/types.go', 1, 99999),
 ('T-KEYS', C, 17471, 17775), ('K-OBJ', C, 25126, 25394), ('T-RSTACK', C, 18861, 18958),
 ('C-INIT', C, 908, 1503), ('D-SINK', C, 14052, 14168), ('S-MERGE', C, 14170, 14531),
 ('N-RESOLVE', 'binder/nameresolver.go', 1, 99999), ('N-RESOLVE', C, 2182, 2200), ('N-RESOLVE', C, 13991, 14050),
 ('N-DIAG', C, 1505, 2180), ('A-ALIAS', C, 14533, 15193), ('A-ALIAS', C, 15830, 15861), ('A-ALIAS', C, 16349, 16493),
 ('M-MODULE', C, 15195, 15828), ('M-MODULE', C, 16014, 16347), ('Q-ENTITY', C, 15863, 16012),
]
TYPEL = [
 ('K-LIT', C, 25396, 25676),
 ('K-PRED', C, 26348, 26371), ('K-PRED', C, 26575, 26770), ('K-PRED', C, 27729, 27794), ('K-PRED', C, 27926, 27987),
 ('K-PRED', C, 28278, 28281), ('K-PRED', C, 31607, 31612),
 ('K-GENERIC', C, 24991, 25074),
 ('K-UNION', C, 25677, 26146), ('K-UNION', C, 26771, 26802),
 ('K-INTERSECT', C, 26147, 26347), ('K-INTERSECT', C, 26372, 26574),
 ('T-TUPLE', C, 23410, 23693), ('T-TUPLE', C, 24791, 24804), ('T-TUPLE', C, 24820, 24990), ('T-TUPLE', R, 1915, 1946),
 ('T-DECLARED', C, 17413, 17470), ('T-DECLARED', C, 23779, 24034), ('T-DECLARED', C, 24040, 24060), ('T-DECLARED', C, 24217, 24224),
 ('T-ENUMVAL', C, 24035, 24039), ('T-ENUMVAL', C, 24061, 24216),
 ('T-TYPENODE', C, 22913, 23409), ('T-TYPENODE', C, 23694, 23778), ('T-TYPENODE', C, 24225, 24391), ('T-TYPENODE', C, 24690, 24697),
 ('T-CONSTRAINT', C, 17141, 17412), ('T-CONSTRAINT', C, 22047, 22162), ('T-CONSTRAINT', C, 27551, 27728), ('T-CONSTRAINT', C, 29255, 29267),
 ('T-BASE', C, 17030, 17131), ('T-BASE', C, 19281, 19406), ('T-BASE', C, 19612, 19711),
 ('T-MEMBERS', C, 19176, 19280), ('T-MEMBERS', C, 19712, 19919), ('T-MEMBERS', C, 20764, 21007), ('T-MEMBERS', C, 22163, 22213),
 ('T-UIMEMBERS', C, 21166, 21516), ('T-UIMEMBERS', C, 21528, 21828), ('T-UIMEMBERS', C, 13611, 13626), ('T-UIMEMBERS', C, 27795, 27828),
 ('T-LOOKUP', C, 18960, 19175), ('T-LOOKUP', C, 21517, 21527),
 ('T-APPARENT', C, 21829, 22006),
 ('T-SIGDECL', C, 19920, 20239),
 ('T-SIGSHAPE', R, 1708, 1914), ('T-SIGSHAPE', R, 1947, 2151), ('T-SIGSHAPE', C, 27855, 27925), ('T-SIGSHAPE', C, 9721, 9738),
 ('T-SIGSHAPE', C, 29124, 29134), ('T-SIGSHAPE', C, 17132, 17140),
 ('T-SIGINST', C, 19407, 19611), ('T-SIGINST', C, 20722, 20763),
 ('T-INSTANTIATE', C, 22007, 22046), ('T-INSTANTIATE', C, 22214, 22598), ('T-INSTANTIATE', C, 22632, 22637),
 ('T-INSTANTIATE', C, 22856, 22912), ('T-INSTANTIATE', C, 24602, 24661),
 ('T-SYMTYPE', C, 16495, 17029), ('T-SYMTYPE', C, 17777, 18468), ('T-SYMTYPE', C, 18617, 18859), ('T-SYMTYPE', C, 29198, 29227),
 ('T-WIDEN', C, 18469, 18616), ('T-WIDEN', C, 20566, 20648), ('T-WIDEN', C, 28282, 28311),
 ('K-KEYOF', C, 26803, 26944), ('K-KEYOF', C, 26957, 27045),
 ('K-INDEXED', C, 27046, 27516), ('K-INDEXED', C, 28025, 28128), ('K-INDEXED', C, 28152, 28162), ('K-INDEXED', C, 29414, 29448),
 ('K-SUBST', C, 26945, 26956), ('K-SUBST', C, 27517, 27550), ('K-SUBST', C, 25075, 25125), ('K-SUBST', C, 31694, 31702),
 ('K-COND', C, 24392, 24601), ('K-COND', C, 24662, 24689), ('K-COND', C, 22599, 22631), ('K-COND', C, 28129, 28151),
 ('T-MAPPED', C, 21008, 21165), ('T-MAPPED', C, 22638, 22855), ('T-MAPPED', C, 28250, 28277), ('T-MAPPED', C, 29135, 29186),
 ('K-TEMPLATE', C, 29268, 29413), ('K-TEMPLATE', R, 2354, 2558),
 ('K-IMPORTTYPE', C, 24698, 24790),
]
PRINT = [('P-PRINT', 'checker/printer.go', 1, 99999), ('P-PRINT', 'checker/nodebuilder.go', 1, 99999),
         ('P-PRINT', 'checker/nodebuilderimpl.go', 1, 99999), ('P-PRINT', 'checker/nodebuilderscopes.go', 1, 99999),
         ('P-PRINT', 'checker/symbolaccessibility.go', 1, 99999), ('P-PRINT', 'checker/pseudotypenodebuilder.go', 1, 99999)]
# The seven layers of this unit, after the ranges of relater.go that T-SIGSHAPE, T-TUPLE and K-TEMPLATE own are taken out.
RELINF = [
 ('R-REL', R, 1, 422), ('R-ELAB', R, 424, 675), ('R-REL', R, 677, 870), ('R-DISCRIM', R, 872, 950), ('R-REL', R, 952, 1028),
 ('R-DISCRIM', R, 1030, 1268), ('R-REL', R, 1270, 1315), ('R-VARIANCE', R, 1317, 1485), ('R-SIGREL', R, 1487, 1707),
 ('R-SIGREL', R, 2152, 2313), ('R-REL', R, 2315, 2353), ('R-SIGREL', R, 2559, 2567), ('R-REL', R, 2569, 3933),
 ('R-VARIANCE', R, 3935, 3999), ('R-REL', R, 4001, 4019), ('R-DISCRIM', R, 4021, 4130), ('R-REL', R, 4132, 4471),
 ('R-SIGREL', R, 4473, 4608), ('R-REL', R, 4610, 5044),
 ('R-REL', C, 27988, 28023), ('R-REL', C, 28163, 28248),
 ('I-INFER', I, 1, 998), ('I-REVMAP', I, 1000, 1183), ('I-INFER', I, 1185, 1684),
]
MINE = ['R-REL', 'R-SIGREL', 'R-VARIANCE', 'R-DISCRIM', 'R-ELAB', 'I-INFER', 'I-REVMAP']
CORE_ORDER = ['TYPES', 'LINKS', 'MAPPER', 'UTIL', 'T-KEYS', 'K-OBJ', 'T-RSTACK', 'C-INIT', 'D-SINK', 'S-MERGE', 'N-RESOLVE', 'N-DIAG', 'A-ALIAS', 'M-MODULE', 'Q-ENTITY']
TYPE_ORDER = ['K-LIT', 'K-PRED', 'K-GENERIC', 'K-UNION', 'K-INTERSECT', 'T-TUPLE', 'T-DECLARED', 'T-ENUMVAL', 'T-TYPENODE',
         'T-CONSTRAINT', 'T-BASE', 'T-MEMBERS', 'T-UIMEMBERS', 'T-LOOKUP', 'T-APPARENT', 'T-SIGDECL', 'T-SIGSHAPE',
         'T-SIGINST', 'T-INSTANTIATE', 'T-SYMTYPE', 'T-WIDEN', 'K-KEYOF', 'K-INDEXED', 'K-SUBST', 'K-COND', 'T-MAPPED',
         'K-TEMPLATE', 'K-IMPORTTYPE']
EARLIER = set(CORE_ORDER + TYPE_ORDER + ['P-PRINT'])
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
    return file.split('/')[-1]
def layer_of(f):
    for table in (RELINF, TYPEL, CORE, PRINT):
        for name, file, lo, hi in table:
            if f['file'] == file and lo <= f['decl'] <= hi:
                return name
    return None
def load(path='/tmp/k3a/fns.json'):
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
