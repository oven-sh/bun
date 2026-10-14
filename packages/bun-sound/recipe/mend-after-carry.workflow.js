// mend-after-carry.workflow.js: behind carry.py. The types of one version were carried to another line by line; the changed lines came in bare.
// Cut carry.py's out/typed.cts into parts/ at the lines `piecework.py split` prints for the new original.js (the carried text has the new file's lines, one for one, behind its /// <reference> heads), then run this.
// react-dom/server 19.3.0 -> 19.2.8 -> 19.1.0 -> 19.0.0 took about fifteen minutes each.
const W = '/absolute/path/to/the/project/folder'
const WHAT_IT_IS = 'react-dom 19.2.8, cjs/react-dom-server.bun.production.js'
const OLD_TYPED = '/absolute/path/to/the/typed/text/of/the/version/it/was/carried/from'
const N = 12
const TOOL = 'python3 /absolute/path/to/packages/bun-sound/tools/piecework.py'
const SPLITS = 'python3 /absolute/path/to/packages/bun-sound/tools/splits1.py typed.cts work/splits "$SEMA"'

export const meta = { name: 'mend-after-carry', description: 'Mend carried types until the checker, verify and the split checker are clean', phases: [{ title: 'Mend' }, { title: 'Report' }] }

const RULES = `
The types of a typed bundle were carried, line by line, to ${WHAT_IT_IS}. A line that is the same in both versions kept its types; a line that differs came in bare, as published.
What is left: the bare lines want their types, and where a kept line and a bare line share a variable that had been split into roles ($given, $as<Role>), the split is broken.
Work only inside ${W}: original.js (this version's file: the law) · parts/NN.cts (what you edit) · the shapes, as written for the other version: where this version's literal or constructor has other members, change the interface.
The typed text of the other version, to look things up in (read only): ${OLD_TYPED}
Gates, from that folder: ${TOOL} errors [NN] | bang NN | verify ; ${SPLITS}
  WRONG      a read of one role that a store to another role can reach
  NOT LOCAL  a role of a variable that this version's function does not declare: take the marked declaration out or rename it after this version's variable
Only types are added; see the rules in type-a-package.workflow.js. A function with no error may still be bare: look for parameter lists without a colon.`

const PART = { type: 'object', properties: { part: { type: 'integer' }, errorsLeft: { type: 'integer' }, verifyPass: { type: 'boolean' }, splitsClean: { type: 'boolean' }, shapeRequests: { type: 'array', items: { type: 'string' } } }, required: ['part', 'errorsLeft', 'verifyPass', 'splitsClean', 'shapeRequests'] }
const COUNTS = { type: 'object', properties: { total: { type: 'integer' }, byPart: { type: 'array', items: { type: 'integer' } }, verifyPass: { type: 'boolean' }, splitsClean: { type: 'boolean' }, splitsText: { type: 'string' } }, required: ['total', 'byPart', 'verifyPass', 'splitsClean', 'splitsText'] }
const idx = Array.from({ length: N }, (_, i) => i)

phase('Mend')
let counts = null, parts = []
for (let round = 1; round <= 6; round++) {
  counts = await agent(`Run in ${W}: ${TOOL} errors ; ${TOOL} verify ; ${SPLITS} . Return the total, the count for each of the ${N} pieces, whether verify says PASS, whether the split checker's last line says every split is the bundle's own program, and its WRONG | NOT LOCAL | CAPTURED lines verbatim.`, { label: 'count:' + round, phase: 'Mend', schema: COUNTS })
  log('round ' + round + ': ' + (counts ? counts.total + ' errors; splits ' + counts.splitsClean : '?'))
  if (!counts || (counts.total === 0 && counts.verifyPass && counts.splitsClean)) break
  const bad = idx.filter(i => round === 1 || counts.byPart[i] > 0 || parts.some(p => p && p.part === i && !p.splitsClean))
  parts = await parallel((bad.length ? bad : idx).map(i => () => agent(RULES + `\n\nYour task: piece ${i}: ${counts.byPart[i] || 0} errors. The split checker on the whole text says:\n${String(counts.splitsText).slice(0, 5000)}`, { label: 'mend' + round + ':' + i, phase: 'Mend', schema: PART })))
}
phase('Report')
const report = await agent(RULES + `\n\nYour task: the last look. Return the three gates' results, every interface that changed against the other version with this version's birth line, and every function that is still bare.`, { label: 'report', phase: 'Report' })
return { counts, report }
