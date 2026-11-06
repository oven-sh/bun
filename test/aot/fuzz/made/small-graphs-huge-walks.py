#!/usr/bin/env python3
"""small-graphs-huge-walks.py <folder>: The build evaluates texts and values that are known when it runs. These are small as graphs and huge as walks: the build must end. Each program has 12 places that ask for the walk, and a run prints `done`. a*: roads to a real walk by `+`, a template, a property key. b*: roads through a call."""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
d = '.'
def program(make, use): return make + '\n' + '\n'.join('export function f%d() { return new RegExp("%d" + %s); }' % (i, i, use) for i in range(12)) + '\nconsole.log("done", typeof f0);\n'
arrays = 'let shared = [1];\nfor (let i = 0; i < 40; i++) shared = [shared, shared];'
objects = 'let shared = { leaf: 1 };\nfor (let i = 0; i < 40; i++) shared = { a: shared, b: shared };'
rows = {
 'a0_control_small.mjs': ('let shared = [1];\nfor (let i = 0; i < 4; i++) shared = [shared, shared];', 'shared'),
 'a1_arrays_and_plus.mjs': (arrays, 'shared'),
 'a2_arrays_in_a_template.mjs': (arrays, '`${shared}`'),
 'a3_arrays_as_a_key.mjs': (arrays, '({ x: 1 })[shared]'),
 'b1_arrays_and_join.mjs': (arrays, 'shared.join("|")'),
 'b2_arrays_and_String.mjs': (arrays, 'String(shared)'),
 'b3_objects_with_index_keys.mjs': ('let shared = { leaf: 1 };\nfor (let i = 0; i < 40; i++) shared = { 0: shared, 1: shared };', 'JSON.stringify(shared)'),
 'b4_wide_first_then_deep.mjs': (objects + '\nconst wide = [];\nfor (let i = 0; i < 5000; i++) wide.push({ i });\nconst both = { wide, shared };', 'JSON.stringify(both)'),
 'b5_the_authors_own.mjs': (objects, 'JSON.stringify(shared, null, 2)'),
 'b6_27_deep_is_affordable.mjs': ('let shared = { leaf: 1 };\nfor (let i = 0; i < 26; i++) shared = { a: shared, b: shared };', 'JSON.stringify(shared, null, 2)'),
}
for name, (make, use) in rows.items(): open(d + '/' + name, 'w').write(program(make, use))
