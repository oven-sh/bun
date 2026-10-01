# Scratch copies of the functions of K3 steps 28 to 30 in the two files that other steps share (c11, c47): usage parts.py <work dir>
import re, sys
W = sys.argv[1]
CK = '/workspace/wt/typecheck/src/typecheck/checker/'
def part(src_name, out_name, first_fn, last_fn):
    t = open(CK + src_name).read()
    head_end = t.index("impl<'a> Checker<'a> {")
    head = t[:head_end]
    a = t.index("    pub fn %s(" % first_fn)
    prev_line_start = t.rfind('\n', 0, a - 1) + 1
    if t[prev_line_start:a].strip().startswith('//'):
        a = prev_line_start
    b = t.index("    pub fn %s(" % last_fn)
    e = t.index("\n    }\n", b) + len("\n    }\n")
    body = t[a:e]
    uses = []
    for m in re.finditer(r'^use ([\w:]+)::\{([^}]*)\};|^use ([\w:]+)::(\w+);', head, re.M | re.S):
        if m.group(1):
            path = m.group(1)
            names = [n.strip() for n in m.group(2).split(',') if n.strip()]
            keep = []
            for n in names:
                key = path.split('::')[-1] if n == 'self' else n
                if n == 'Checker' or re.search(r'\b%s\b' % re.escape(key), body):
                    keep.append(n)
            if keep:
                uses.append("use %s::{%s};" % (path, ", ".join(keep)))
        else:
            if re.search(r'\b%s\b' % re.escape(m.group(4)), body):
                uses.append("use %s::%s;" % (m.group(3), m.group(4)))
    out = "// Scratch copy of the functions %s..%s of %s\n" % (first_fn, last_fn, src_name) + "\n".join(uses) + "\n\nimpl<'a> Checker<'a> {\n" + body + "}\n"
    open(W + '/' + out_name, 'w').write(out)
    print(out_name, len(out.splitlines()), "lines")
part('c11_check_variables_decorators.rs', 'c11_part.rs', 'check_decorators', 'check_decorator')
part('c47_promised_mapped_template.rs', 'c47_part.rs', 'get_promised_type_of_promise', 'get_type_of_first_parameter_of_signature_with_fallback')
