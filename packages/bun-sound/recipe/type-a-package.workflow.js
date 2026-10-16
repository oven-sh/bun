// type-a-package.workflow.js: the fan-out we used to type seroval (3,096 lines, 10 agents, 31 minutes) and react-dom/server (7,828 lines, 17 agents).
// It is written for an agent runner that offers agent(prompt, options), parallel(thunks), phase(title) and log(text); any runner will do, and so will people.
// Set the four constants, create the project folder as the README says (original.js, project.json, births.txt), and run it.
const W = '/absolute/path/to/the/project/folder'
const WHAT_IT_IS = 'seroval 1.6.9, dist/index.js: an ES module, not minified'
const SPACE = 'SV', SHAPES = 'sv-shapes', EXT = 'mts'   // 'cts' for a CommonJS bundle
const N = 7                                             // what `piecework.py split` printed
const TOOL = 'python3 /absolute/path/to/packages/bun-sound/tools/piecework.py'

export const meta = {
  name: 'type-a-package',
  description: 'Add TypeScript types to one published file in place, in pieces, until the checker is clean and the code is unchanged',
  phases: [{ title: 'Shapes' }, { title: 'Annotate' }, { title: 'Fix' }, { title: 'Report' }],
}

const WHAT = `
We are adding TypeScript types to a published npm file, in place. Bun's ahead-of-time compiler gives an object a fixed layout where its type is known and reads its fields by offset; without types every property is looked up by name.
The file: ${WHAT_IT_IS}.
Work only inside ${W}:
  original.js        the file as published. It is the law: types describe what this code does.
  births.txt         every object literal and constructor in it, by members, with line numbers
  ${SHAPES}.d.ts     the shared declarations: declare namespace ${SPACE} { .. }. Ambient: write ${SPACE}.Name in annotations, no import.
  ${SHAPES}-NN.d.ts  piece NN's own additions (interfaces merge). Only piece NN's author writes it.
  parts/NN.${EXT}    piece NN: what you edit
Run from that folder: ${TOOL} take NN | errors [NN [max]] | bang NN | verify | stats`

const SHAPE_RULES = `
Rules for a shapes file
S1. \`declare namespace ${SPACE} { .. }\`, nothing else at top level except \`declare var\` | \`declare function\` for globals the standard library may lack. Each interface or type starts a line of its own, indented two spaces.
S2. One interface for every object the file creates and keeps. Members in the order the literal (or constructor) writes them; all of them and no others; a comment \`// birth <line>\`.
S3. Each member's type covers everything the file ever stores to it: created null and filled later is \`T | null\`.
S4. If many "kinds" of object come out of one literal they are ONE interface, however the authors' own .d.ts slices them.
S5. Start with \`type int32 = import("bun").int32;\`. Flags, ids, modes, indexes, counts are aliases of int32. A value that is not an int32 stored there throws at run time, so anything that can be fractional, huge, or supplied from outside stays \`number\` or given.
S6. What other code creates is GIVEN: \`any\` through a named alias, in a section headed \`// GIVEN\`: user values, options bags, callbacks, plugins, props, anything out of JSON.parse. If a shape is created here AND can be handed in from outside, its type must accept what comes in (members that may be missing are optional), or the functions that take it from outside take the given alias.
S7. No union of two created shapes, except where the data model really has one in a field. Objects used as dictionaries are \`{ [key: string]: T }\`, Map or Set.`

const RULES = WHAT + `
Rules
1. Only types are added: annotations on parameters, results, variables and class fields, \`this:\` parameters, generics, \`!\`, casts. No statement, expression, name, order or literal changes. No comments. \`verify\` must say PASS.
2. Every parameter, every result that inference does not get right, every variable declared empty or null gets a precise type.
3. No \`any\` for what the file itself creates. For what other code creates use the GIVEN alias; that is right and wanted. Never \`as any\` to silence an error about a created shape.
4. A cast is checked at run time. Prefer narrowing. A cast inside a body stands between markers: \`x/*$*/ as ${SPACE}.T/*$*/\`. Anything else you must insert also stands between \`/*$*/\` markers, on an existing line: a marked variable, or the fields of a class that only assigns them in its constructor: \`class X { /*$*/declare a: T; declare b: U;/*$*/\` (always \`declare\`: nothing may be emitted).
5. \`!\` is cheap: do not place it by hand, run \`bang NN\`.
6. A value out of \`any\` that other code may have created is never annotated as, passed to, or stored into a created shape.
7. An object literal gets its layout only where it is checked against its type: a declared result, an annotated variable, a typed field or parameter. A literal with a null, undefined or constant member that is filled in later MUST stand under a declared type.
8. A variable that the (minified) code reuses for a value of another shape gets a marked variable per role: declare \`/*$*/var x$asRole: ${SPACE}.T;/*$*/\` behind the function's \`{\` and write the suffix at every store and read of that role. A read gets the suffix if and only if every store that can reach it has it.
9. No \`declare global\`, no augmenting built-ins. A member the standard library lacks: \`/*$*/(/*$*/x/*$*/ as any)/*$*/.member\`.
10. One process at a time, nothing longer than a minute, no network, do not run the package.` + SHAPE_RULES

const PART = { type: 'object', properties: { part: { type: 'integer' }, errorsLeft: { type: 'integer' }, verifyPass: { type: 'boolean' }, shapeRequests: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['part', 'errorsLeft', 'verifyPass', 'shapeRequests'] }
const COUNTS = { type: 'object', properties: { total: { type: 'integer' }, byPart: { type: 'array', items: { type: 'integer' } }, verifyPass: { type: 'boolean' } }, required: ['total', 'byPart', 'verifyPass'] }
const idx = Array.from({ length: N }, (_, i) => i)

phase('Shapes')
const shapes = await agent(WHAT + SHAPE_RULES + `\n\nYour task: write ${W}/${SHAPES}.d.ts from births.txt and original.js (and the package's own .d.ts if it has one: it says what is meant; the code says what is so). It must parse. Return: the interfaces with their births, the GIVEN aliases, what you were unsure of, and which functions take objects from outside.`, { label: 'shapes', phase: 'Shapes' })

phase('Annotate')
let parts = await parallel(idx.map(i => () => agent(RULES + `\n\nThe shapes' author says: ${String(shapes).slice(0, 3500)}\n\nYour task: piece ${i}. \`take ${i}\`, read ${SHAPES}.d.ts whole, annotate the piece top to bottom; after each stretch \`bang ${i}\`, \`errors ${i}\`. Other pieces are being annotated at the same time: an error caused by a function that is not annotated yet can wait for the Fix phase. End with \`errors ${i}\` and \`verify\`.`, { label: 'part:' + i, phase: 'Annotate', schema: PART })))

phase('Fix')
let counts = null
for (let round = 1; round <= 5; round++) {
  const asked = parts.filter(Boolean).flatMap(p => (p.shapeRequests || []).map(s => 'piece ' + p.part + ': ' + s))
  if (asked.length) await agent(RULES + `\n\nYour task: you keep ${SHAPES}.d.ts. Judge each request against original.js and make the ones that are right.\n` + asked.join('\n').slice(0, 12000), { label: 'shapes:' + round, phase: 'Fix' })
  counts = await agent(`Run in ${W}: ${TOOL} errors ; ${TOOL} verify . Return the total, the count for each of the ${N} pieces, and whether verify says PASS.`, { label: 'count:' + round, phase: 'Fix', schema: COUNTS })
  log('round ' + round + ': ' + (counts ? counts.total : '?') + ' errors')
  if (!counts || (counts.total === 0 && counts.verifyPass)) break
  parts = await parallel(idx.filter(i => counts.byPart[i] > 0).map(i => () => agent(RULES + `\n\nYour task: piece ${i} still has ${counts.byPart[i]} errors now that every piece is annotated. Where two pieces disagree, read the other function and decide by what the code stores and passes.`, { label: 'fix' + round + ':' + i, phase: 'Fix', schema: PART })))
}

phase('Report')
const report = await agent(RULES + `\n\nYour task: the last look. Return: errors, verify, stats; every place where a value out of \`any\` enters an annotated variable, parameter or field typed as a created shape, with who can have created the value; every literal under no declared type that has a null, undefined or constant member stored to later; the places where an \`any\` or a cast sits in a function that runs once per item.`, { label: 'report', phase: 'Report' })
return { counts, report }
