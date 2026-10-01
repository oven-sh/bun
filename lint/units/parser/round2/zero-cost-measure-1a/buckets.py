#!/usr/bin/env python3
"""Bucket the per-symbol differences of two cachegrind files.
usage: buckets.py <a.cg> <b.cg> [--list BUCKET] [--top N]"""
import re, sys, collections
def arg(k, d=None): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
def load(path):
    fn = None; per = collections.defaultdict(lambda: [0, 0, 0, 0, 0])
    with open(path, errors='replace') as f:
        for line in f:
            if line.startswith('fn='): fn = re.sub(r' \(\.llvm\.\d+\)$', '', line[3:].rstrip('\n')); continue
            if not line[0].isdigit(): continue
            parts = line.split(); vals = [int(x) for x in parts[1:6]]; vals += [0] * (5 - len(vals))
            p = per[fn]
            for i in range(5): p[i] += vals[i]
    return per
TYPE = re.compile(r'>::(parse_type\w*|parse_\w*_type\w*|skip_type_script\w*|skip_typescript\w*|try_skip_type_script\w*|parse_postfix\w*|parse_union\w*|parse_property_or_method_signature\w*|parse_tuple\w*|parse_mapped\w*|parse_bracketed\w*|is_start_of\w*|next_is_\w*|next_token_is\w*|parse_entity\w*|parse_right_side\w*|parse_conditional\w*|parse_function_or_constructor\w*|parse_asserts\w*|parse_heritage\w*|look_ahead|parse_accessor_declaration|parse_signature_member|parse_index_signature\w*|parse_modifiers_of_type_member|is_index_signature|parse_keyword_type_node|parse_non_array_type|parse_infer_type|scan_start_of\w*|parse_import_attributes\w*|reread_\w+|parse_and_drop_in_type|parse_initializer_in_type|parse_function_block\w*|parse_computed_property_name|parse_expression_with_type_arguments|is_word_that_starts_no_type|is_reserved_type_name|type_expected|rewind_to_read_mark|set_aside_failed_read|restore_failed_read|set_type_script_memo_at|is_valid_heritage\w*|next_is_valid\w*)(::<.*>)?$')
def bucket(n):
    if n is None: return 'z other'
    if 'bun_js_parser' not in n and 'bun_ast' not in n:
        if re.search(r'^_?mi_|^mi_|mimalloc|^free$|^malloc$|AstAlloc|bun_alloc', n): return 'y allocator (mimalloc, AstAlloc)'
        if re.search(r'mem(cpy|move|set|cmp)', n): return 'x memcpy/memmove/memset/memcmp'
        if re.search(r'JSC::|WTF::|Inspector|llint|jsc|Bun::|Zig::|WebCore', n): return 'w JavaScriptCore and bindings'
        if re.search(r'bun_js_printer|js_printer', n): return 'v printer'
        return 'z other non-parser'
    if 'lexer_backtracker' in n or 'Vec<bun_ast::Msg>>::truncate' in n or 'rewind_lint_attempt' in n or 'sidecar' in n: return 'd backtracker (attempt wrappers, log truncate)'
    if 'parse_stmt_named_like_cast' in n or 'is_declaration_named_like_cast' in n or 'read_declaration_named_like_cast' in n: return 'a2 statement named like a cast (lookahead)'
    if 'is_class_index_signature' in n: return 'a3 class index signature lookahead'
    if re.search(r'lexer::Lexer>::|lexer_tables|lexer::', n): return 'a4 lexer (tokens read again)'
    if TYPE.search(n): return 'a1 type grammar'
    if re.search(r'P<(true|false), ?(true|false)>>::(visit_\w+|s_\w+|e_\w+|lower_\w+|hoist_symbols|to_ast|declare_\w+|record_\w+|find_symbol\w*|handle_identifier|part_use|maybe_\w+|load_name_from_ref|push_scope\w*|pop_\w+|new_symbol|store_name_in_ref|init|default_name_for_expr|ignore_\w+)', n) or 'visit' in n or 'drop_glue' in n or 'scope::' in n or 'symbol::' in n: return 'f visit pass, symbols, drop glue'
    if re.search(r'P<(true|false), ?(true|false)>>::|parse_entry|Parser>::', n): return 'b parse pass outside the type grammar'
    return 'g other bun_js_parser / bun_ast'
if __name__ == '__main__':
    a = load(sys.argv[1]); b = load(sys.argv[2])
    agg = collections.defaultdict(lambda: [0, 0, 0, 0, 0, 0]); rows = collections.defaultdict(list)
    for n in set(a) | set(b):
        x = a.get(n, [0] * 5); y = b.get(n, [0] * 5)
        k = bucket(n); t = agg[k]
        t[0] += y[0] - x[0]; t[1] += y[1] - x[1]; t[2] += y[3] - x[3]; t[3] += x[1]; t[4] += y[1]; t[5] += 1 if (x[0], x[1], x[3]) != (y[0], y[1], y[3]) else 0
        if (x[0], x[1], x[3]) != (y[0], y[1], y[3]): rows[k].append((y[1] - x[1], y[0] - x[0], y[3] - x[3], x[1], n))
    tot = [sum(v[i] for v in agg.values()) for i in range(5)]
    print(f'program                                           dIr {tot[0]:+13,}  dBc {tot[1]:+12,}  dBi {tot[2]:+10,}   Bc {tot[3]:,} -> {tot[4]:,}')
    for k in sorted(agg):
        v = agg[k]
        print(f'{k[:48]:48}  dIr {v[0]:+13,}  dBc {v[1]:+12,}  dBi {v[2]:+10,}   ({v[5]} symbols differ)')
    want = arg('--list')
    if want:
        for k in sorted(rows):
            if not k.startswith(want): continue
            print('--', k)
            for r in sorted(rows[k], key=lambda r: -abs(r[0]))[:int(arg('--top', 40))]:
                print(f'  Bc {r[0]:+11,}  Ir {r[1]:+12,}  Bi {r[2]:+9,}  (a Bc {r[3]:,})  {(r[4] or "?")[:150]}')
