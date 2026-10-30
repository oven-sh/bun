#!/usr/bin/env python3
"""abandoned-walk-cost.py <folder>: A shallow built-in is handed something whose walk would be too long (a cycle; over 4,096 objects), and the text of the RegExp is made BEHIND that call in the same walk: not only the one answer may be lost but the rest of the walk. The program must still answer as plain Bun."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
d = '.'
tail = '\nconst source = "^(" + table.name + ")$";\nexport function f() { return new RegExp(source); }\nconsole.log(f().test("a"), typeof asked);\n'
cycle = 'const table = { name: "a|b" };\ntable.self = table;\n'
parent = 'const table = { name: "a|b", children: [] };\nfor (let i = 0; i < 3; i++) table.children.push({ i, parent: table });\n'
wide = 'const table = { name: "a|b", wide: [' + ', '.join('{ i: %d }' % i for i in range(4200)) + '] };\n'
plain = 'const table = { name: "a|b", other: { x: 1 } };\n'
rows = {
 'c0_control_no_cycle_keys.mjs': plain + 'const asked = Object.keys(table);',
 'c1_cycle_keys.mjs': cycle + 'const asked = Object.keys(table);',
 'c2_cycle_has_own_property.mjs': cycle + 'const asked = Object.prototype.hasOwnProperty.call(table, "name");',
 'c3_cycle_pushed.mjs': cycle + 'const asked = []; asked.push(table);',
 'c4_cycle_define_property.mjs': cycle + 'const asked = Object.defineProperty(table, "__esModule", { value: true });',
 'c5_parents_assign.mjs': parent + 'const asked = Object.assign({}, table);',
 'c6_cycle_is_array.mjs': cycle + 'const asked = Array.isArray(table);',
 'c7_cycle_in_a_map.mjs': cycle + 'const asked = new Map(); asked.set("k", table);',
 'c8_cycle_compared.mjs': cycle + 'const asked = table == "x";',
 'w1_wide_keys.mjs': wide + 'const asked = Object.keys(table);',
}
for name, text in rows.items(): open(d + '/' + name, 'w').write(text + tail)
