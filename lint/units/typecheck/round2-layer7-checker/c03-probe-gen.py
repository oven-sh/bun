#!/usr/bin/env python3
# Writes checker_stubs.rs for the probe of checker/c03_init.rs: the stand-in Checker holds the fields that c03_init.rs
# names, each with its type of the real c02_program_checker.rs (a Map of any key is Map<u64, u64>, file_index_map aside).
# usage: c03-probe-gen.py <work dir>   (reads c03-probe-stubs-head.rs and c03-probe-stubs-tail.rs beside this script)
import os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
work = sys.argv[1]
SRC = '/workspace/wt/typecheck/src/typecheck'
src = open(SRC + '/checker/c03_init.rs').read()
c02 = open(SRC + '/checker/c02_program_checker.rs').read()
block = re.search(r'checker_fields! \{(.*?)\n\}\n', c02, re.S).group(1)
ftypes = dict(re.findall(r'^\s+(\w+):\s*(.+?),\s*$', block, re.M))
code = '\n'.join(l for l in src.split('\n') if not l.strip().startswith('//'))
code = re.sub(r'//.*', '', code)
used = sorted(set(re.findall(r'\bc\.(\w+)\b(?!\()', code)) | set(re.findall(r'\bself\.(\w+)\b(?!\()', code)))
unknown = [f for f in used if f not in ftypes]
if unknown:
    sys.exit('c03_init.rs names fields that c02_program_checker.rs does not have: %s' % unknown)
def conv(name, t):
    t = t.strip()
    if t.startswith('Map<') and name != 'file_index_map':
        return 'Map<u64, u64>'
    if t.startswith('SymbolArenaLinkStore<'):
        return 'LinkStore<SymbolId, ' + t[len('SymbolArenaLinkStore<'):]
    return t
sinks = [('sink_literal', "LiteralType<'a>"), ('sink_object', "ObjectType<'a>"), ('sink_type_parameter', 'TypeParameter'), ('sink_interface', "InterfaceType<'a>")]
out = ["pub struct Checker<'a> {"]
out += ['    pub %s: %s,' % s for s in sinks]
out += ['    pub %s: %s,' % (f, conv(f, ftypes[f])) for f in used]
out += ['}', "impl<'a> Checker<'a> {",
        "    pub fn zero(ast: Ast<'a>, lists: &'a CheckerArena<'a>, program: &'a dyn Program<'a>, compiler_options: &'a CompilerOptions) -> Self {",
        '        let _ = (lists, program);', '        Self {']
out += ['            %s: Default::default(),' % s[0] for s in sinks]
for f in used:
    out.append('            %s,' % f if f in ('ast', 'compiler_options') else '            %s: Default::default(),' % f)
out += ['        }', '    }', '}']
head = open(here + '/c03-probe-stubs-head.rs').read()
tail = open(here + '/c03-probe-stubs-tail.rs').read()
open(work + '/checker_stubs.rs', 'w').write(head + '\n'.join(out) + '\n' + tail)
print('%d fields of the Checker are named by c03_init.rs' % len(used))
