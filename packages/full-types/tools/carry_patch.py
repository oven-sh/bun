#!/usr/bin/env python3
"""carry_patch.py <npm's file> <full types of npm's file> <the installed, patched file> <out: full types of the patched file> [<bun> <work folder>]
A project that patches a package (bun patch, patch-package) needs full types of ITS bytes. The typed text stands line for line beside npm's file (checked here), so:
a line the patch leaves alone keeps its types; a line the patch adds or changes comes in as the patch wrote it.
With <bun> and a work folder (tsconfig.json in it, its "files" naming check.cts): the checker is run, and where an added line leaves a parameter or a variable without a type (TS7006, TS7005, TS7034, TS7031)
`: any` is written there. `any` is true of everything. Other errors are printed with their line: they are to be repaired by hand, with types only.
Prints counts only, never the text of a patched line, unless SHOW=1."""
import difflib, json, os, re, subprocess, sys
npm_path, typed_path, installed_path, out_path = sys.argv[1:5]
npm = open(npm_path).read().split('\n'); typed = open(typed_path).read().split('\n'); installed = open(installed_path).read().split('\n')


def is_subsequence(a, b):
    it = iter(b)
    return all(c in it for c in a)


for i, line in enumerate(npm):
    if not is_subsequence(line.replace(' ', ''), typed[i].replace(' ', '')): sys.exit('carry_patch: line %d of the typed text is not line %d of npm\'s file with types added' % (i + 1, i + 1))
out = []; added = []   # added: line numbers (from 0) of the out text that the patch wrote
hunks = 0
for tag, a0, a1, b0, b1 in difflib.SequenceMatcher(None, npm, installed, autojunk=False).get_opcodes():
    if tag == 'equal': out += typed[a0:a1]; continue
    hunks += 1
    added += range(len(out), len(out) + b1 - b0)
    out += installed[b0:b1]
out += typed[len(npm):]   # the shapes
print('carry_patch: %d places, %d lines as the patch wrote them, %d lines keep their types' % (hunks, len(added), len(npm) - 0))
open(out_path, 'w').write('\n'.join(out))
if len(sys.argv) < 7: sys.exit(0)
bun, work = sys.argv[5:7]
mine = set(added)
for attempt in range(8):
    open(work + '/check.cts', 'w').write('\n'.join(out))
    r = subprocess.run([bun, 'check', '--all', '--no-pretty'], cwd=work, capture_output=True, text=True)
    errors = [(int(m.group(1)) - 1, int(m.group(2)) - 1, m.group(3), m.group(4)) for m in re.finditer(r'^check\.cts\((\d+),(\d+)\): error (TS\d+): (.*)$', r.stdout + r.stderr, flags=re.M)]
    errors = [e for e in errors if e[2] not in ('TS4111', 'TS7029', 'TS7030') or e[2] in ('TS7006', 'TS7005', 'TS7034', 'TS7031')]   # matters of style: a build drops them in full types
    fix = [e for e in errors if e[2] in ('TS7006', 'TS7005', 'TS7034', 'TS7031') and e[0] in mine]
    if not fix: break
    for line, column, code, message in sorted(set(fix), reverse=True):
        m = re.compile(r'[A-Za-z_$][\w$]*').match(out[line], column)
        if m and not out[line][m.end():].lstrip().startswith(':'): out[line] = out[line][:m.end()] + ': any' + out[line][m.end():]
open(out_path, 'w').write('\n'.join(out))
print('carry_patch: %d errors are left, %d of them on lines of the patch' % (len(errors), sum(e[0] in mine for e in errors)))
for line, column, code, message in errors[:40]:
    print('  line %d column %d %s%s' % (line + 1, column + 1, code, ' ' + message if os.environ.get('SHOW') or line not in mine else ' (a line of the patch)'))
