import re, sys, os
root = '/workspace/wt/parser/src/js_parser/'
files = sys.argv[1:]
pat = re.compile(r'\b(add_error|add_range_error|add_syntax_error|add_default_error|add_range_error_fmt|add_error_fmt|add_range_error_with_notes|add_range_error_fmt_with_note|add_range_error_fmt_with_notes|add_unsupported_syntax_error|add_error_fmt_opts|add_range_error_fmt_opts|add_range_error_with_note|add_error_with_note|syntax_error|add_range_warning|add_warning|add_range_warning_fmt|add_warning_fmt|add_range_debug|add_debug|add_range_warning_fmt_with_note|add_range_warning_with_note|add_msg|add_symbol_already_declared_error|add_range_debug_with_notes|add_debug_fmt|add_range_debug_fmt)\s*\(')
for f in files:
    src = open(root + f, encoding='utf-8').read().split('\n')
    fn = None
    for i, l in enumerate(src, 1):
        m = re.match(r'\s*(?:pub(?:\([a-z]+\))?\s+)?(?:unsafe\s+)?fn\s+(\w+)', l)
        if m: fn = m.group(1)
        s = l.strip()
        if s.startswith('//'): continue
        mm = pat.search(l)
        if not mm: continue
        if re.search(r'fn\s+' + mm.group(1), l): continue
        # capture text: search next 14 lines for string literal
        blob = ' '.join(x.strip() for x in src[i-1:i+14])
        blob = blob[blob.find(mm.group(0)):]
        t = re.search(r'b?"((?:[^"\\]|\\.)*)"', blob)
        text = t.group(1) if t else '?'
        print(f"{f}:{i}\t{fn}\t{mm.group(1)}\t{text}")
