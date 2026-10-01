#!/usr/bin/env python3
"""Sorts the per-symbol Bc (or Ir) differences of the five groups into causes.
usage: buckets.py <dir> <tag a> <tag b> [--ir] [--list BUCKET]
A symbol goes to the first bucket whose pattern matches its name. Parser symbols only (bun_js_parser, bun_ast)."""
import re, sys, collections
G = ['bun-types', 'typescript-lib', 'src-js', 'tsx', 'js-control']
d, ta, tb = sys.argv[1:4]
col = 0 if '--ir' in sys.argv else 3 if '--bi' in sys.argv else 1
want = sys.argv[sys.argv.index('--list') + 1] if '--list' in sys.argv else None
B = [
 ('startup-js', r'^$'),
 ('backtracker', r'lexer_backtracker_|try_skip_type_script_|Vec<bun_ast::Msg>>::truncate|rewind_sidecar|restore_parser_snapshot|parser_snapshot'),
 ('type grammar', r'>::(parse_type\b|parse_type::|parse_type_\w+|parse_\w*_type\w*|parse_conditional_type_rest|parse_union_or_intersection\w*|parse_function_or_constructor\w*|parse_postfix\w*|parse_non_array\w*|parse_entity_name\w*|parse_right_side_of_dot|parse_import_type\w*|parse_tuple\w*|parse_template_type|parse_mapped\w*|parse_property_or_method_signature\w*|parse_bracketed_name|parse_accessor_declaration|parse_signature_member|parse_index_signature\w*|parse_asserts\w*|parse_heritage\w*|parse_expression_with_type_arguments|parse_modifiers_of_type_member|parse_object_type_members|parse_computed_property_name|next_is_\w+|next_token_is_\w+|is_start_of_type|is_start_of_parameter|is_index_signature|can_follow_\w+|look_ahead|skip_type_script_(type_with_opts|object_type|type_arguments\w*|type_parameters\w*|paren_or_fn_type|paren_type|binding|bracketed_name|predicate\w*|parameter_modifiers|signature_property_name|fn_type_signature|constraint\w*|arrow\w*)|skip_typescript_(fn_args|return_type\w*)|reread_\w+|type_expected|is_reserved_type_name|scan_start_of\w*)(::<.*)?$'),
 ('type statements', r'>::(skip_type_script_type_stmt|skip_type_script_interface_stmt|parse_stmt_named_like_cast|is_declaration_named_like_cast|read_declaration_named_like_cast|parse_stmt_fallthrough_ts_keyword|parse_type_script_namespace_stmt|parse_typescript_enum_stmt|parse_type_script_import_equals_stmt|parse_type_script_decorators)$'),
 ('lexer', r'lexer::Lexer>::|lexer_tables|comptime_string_map'),
 ('statements', r'>::(parse_stmt|parse_stmts_up_to|t_export|t_import|t_try|parse_path|parse_and_declare_decls|parse_class_stmt|parse_fn_stmt|s_export_default|parse_labeled_stmt)$|parse_entry::Parser>::_parse'),
 ('expressions+class', r'>::(parse_prefix|parse_suffix|parse_paren_expr\w*|parse_jsx_element|parse_class|parse_fn|parse_fn_expr|parse_property|is_class_index_signature|parse_arrow_body\w*|parse_async_prefix_expr|paren_expr_has_type_parameters|arrow_parameters_could_be_expr|parse_expr_common|parse_call_args\w*|parse_fn_body|parse_clause_alias)$'),
 ('visit+layout', r'.'),
]
rxs = [(n, re.compile(p)) for n, p in B]
rx = re.compile(r'bun_js_parser|bun_ast')
def load(path):
    fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            c = line[0]
            if c == 'f':
                if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)', '', line[3:].rstrip('\n'))
                continue
            if not c.isdigit(): continue
            parts = line.split(); p = per[fn]
            for i in range(1, min(len(parts), 6)): p[i - 1] += int(parts[i])
    return per
A = {g: load(f'{d}/{ta}.{g}.cg') for g in G}; Bb = {g: load(f'{d}/{tb}.{g}.cg') for g in G}
names = set()
for g in G: names |= set(A[g]) | set(Bb[g])
sums = collections.OrderedDict((n, [0] * 5) for n, _ in B); members = collections.defaultdict(list)
# the JS start-up parse that one base run made: P<false, false> symbols that a TypeScript group has on one side only
def startup(n, g): return g != 'js-control' and 'P<false, false>' in n and ((n in A[g]) != (n in Bb[g]))
for n in names:
    if not n or not rx.search(n): continue
    dv = [Bb[g].get(n, [0] * 5)[col] - A[g].get(n, [0] * 5)[col] for g in G]
    if not any(dv): continue
    su = [dv[i] if startup(n, G[i]) else 0 for i in range(5)]
    if any(su):
        for i in range(5): sums['startup-js'][i] += su[i]; dv[i] -= su[i]
        members['startup-js'].append((su, n))
        if not any(dv): continue
    for b, r in rxs[1:]:
        if r.search(n):
            for i in range(5): sums[b][i] += dv[i]
            members[b].append((dv, n)); break
print('%-18s' % ('cause (' + ['Ir', 'Bc', '', 'Bi'][col] + ')') + ''.join('%15s' % g for g in G))
tot = [0] * 5
for b, v in sums.items():
    print('%-18s' % b + ''.join('%+15d' % x for x in v)); tot = [tot[i] + v[i] for i in range(5)]
print('%-18s' % 'parser symbols' + ''.join('%+15d' % x for x in tot))
if want:
    for dv, n in sorted(members[want], key=lambda r: -sum(abs(x) for x in r[0])):
        print(''.join('%+12d' % x for x in dv) + '  ' + n.replace('bun_js_parser::', '')[:140])
