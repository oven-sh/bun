import sys
rows = [l.rstrip('\n').split('\t') for l in open('/tmp/k3a/checker.outline.tsv')]
decls = [(int(a), int(b), k, n) for a,b,k,n in rows]
SPLIT = [
 (1, 'data', 'DATA'),
 (553, 'program_checker', 'STRUCT'),
 (908, 'init', 'C-INIT'),
 (1505, 'name_resolution_hooks', 'N-DIAG, N-RESOLVE(getSymbol)'),
 (2202, 'check_source_file', ''),
 (2662, 'check_members_type_nodes', ''),
 (3412, 'check_functions', ''),
 (3793, 'check_statements', ''),
 (4286, 'check_classes_interfaces', ''),
 (5148, 'check_enums_modules_imports', ''),
 (5854, 'check_variables_decorators', ''),
 (6185, 'iteration_types', ''),
 (6826, 'check_aliases_unused', ''),
 (7419, 'expressions', ''),
 (8407, 'calls', ''),
 (10133, 'function_expressions_collisions', ''),
 (10707, 'unary_meta_yield', ''),
 (11132, 'identifiers_property_access_this', ''),
 (12378, 'assertions_binary_operators', ''),
 (13235, 'object_literals_spread', ''),
 (13991, 'resolved_symbols_diagnostics', 'N-RESOLVE(4 fns), D-SINK'),
 (14170, 'symbols_merge', 'S-MERGE'),
 (14533, 'alias_targets', 'A-ALIAS'),
 (15195, 'external_modules', 'M-MODULE'),
 (15830, 'entity_names', 'A-ALIAS(getTargetOfAliasDeclaration), Q-ENTITY'),
 (16014, 'exports_late_binding', 'M-MODULE'),
 (16349, 'resolve_alias', 'A-ALIAS'),
 (16495, 'types_of_symbols', ''),
 (17141, 'constraints', ''),
 (17471, 'type_keys', 'T-KEYS'),
 (17777, 'binding_patterns_widening', ''),
 (18861, 'type_resolution', 'T-RSTACK'),
 (18960, 'members_base_types_signatures', ''),
 (20115, 'return_types', ''),
 (20729, 'resolve_members', ''),
 (21513, 'properties_apparent_types', ''),
 (22214, 'instantiation', ''),
 (22913, 'type_nodes_references', ''),
 (23878, 'declared_types_enums', ''),
 (24225, 'type_nodes_conditional_tuples', ''),
 (25126, 'new_types', 'K-OBJ'),
 (25396, 'literal_types', ''),
 (25725, 'unions_intersections', ''),
 (26803, 'index_indexed_access', ''),
 (27551, 'base_constraints_normalization', ''),
 (28312, 'mark_references', ''),
 (29042, 'promised_mapped_template', ''),
 (29449, 'contextual_types', ''),
 (30164, 'call_arguments_decorator_signatures', ''),
 (30674, 'contextual_properties_inference_context', ''),
 (31097, 'type_facts_awaited', ''),
 (31704, 'symbol_at_location', ''),
]
ends = [s[0]-1 for s in SPLIT[1:]] + [32296]
total = 0
for i, ((start, name, layer), end) in enumerate(zip(SPLIT, ends)):
    inside = [d for d in decls if start <= d[0] <= end]
    # check no decl straddles
    bad = [d for d in decls if d[0] < start <= d[1] or d[0] <= end < d[1]]
    funcs = [d for d in inside if d[2] == 'func']
    first = inside[0][3].split(',')[0] if inside else '-'
    last = inside[-1][3].split(',')[0] if inside else '-'
    lastend = inside[-1][1] if inside else 0
    firststart = inside[0][0] if inside else 0
    total += len(funcs)
    flag = ' STRADDLE!' if bad else ''
    print(f"{i+1:02d}\t{start}-{end}\t{end-start+1}\t{len(funcs)}\tc{i+1:02d}_{name}.rs\t{first} .. {last}\t[{firststart}..{lastend}]\t{layer}{flag}")
print('total funcs', total)
