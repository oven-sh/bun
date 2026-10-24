#!/usr/bin/env python3
"""usage: implicit_any.py <typed file> < the errors of `bun check --aot --all --no-pretty <typed file>`

Writes `: any` where the checker says that a parameter, a rest parameter, a variable or a member is implicitly `any`, so that what is
left of the list is what has to be typed by hand. Start with it, then replace the `any` on the code that runs often.

A plain .js file is not without types: the compiler reads its JSDoc (`@param {number} status`) as the types to expect. An `any` written over
such a parameter takes that away, and the file runs slower than it did untyped. Where the JSDoc names a type, write that type."""
import re, sys
path = sys.argv[1]
lines = open(path).read().split('\n')
todo = []
for error in sys.stdin:
    m = re.search(r"\((\d+),(\d+)\): error TS(7006|7019|7008|7034|7005): \w+(?: parameter)? '([^']+)'", error)
    if m and m.group(3) in ('7006', '7019', '7008', '7034'):
        todo.append((int(m.group(1)), int(m.group(2)), m.group(3), m.group(4)))
done = 0
for line, column, code, name in sorted(set(todo), reverse=True):
    text = lines[line - 1]
    at = column - 1
    if code == '7019' and text[at:at + 3] == '...':
        at += 3
    if text[at:at + len(name)] != name:
        print('not at its place: %d:%d %s' % (line, column, name)); continue
    end = at + len(name)
    if code == '7006' and re.match(r'\s*=>', text[end:]) and not re.search(r'[(,]\s*$', text[:at]):
        lines[line - 1] = text[:at] + '(' + name + ': any)' + text[end:]
    else:
        lines[line - 1] = text[:end] + (': any[]' if code == '7019' else ': any') + text[end:]
    done += 1
open(path, 'w').write('\n'.join(lines))
print('%d written' % done)
