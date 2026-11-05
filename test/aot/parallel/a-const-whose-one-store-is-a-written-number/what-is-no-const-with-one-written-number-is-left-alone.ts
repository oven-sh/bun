// Beside the consts stand names that look like them: a let that is stored again, a var, a const made by a call, by arithmetic on a parameter, out of a pattern, of a text, an inner const of the same name, a parameter of the same name.
let COUNT = 1
var STEP = 2
const MADE = Number("5")
const [HEAD, NEXT] = [8, 9]
const { DEEP } = { DEEP: 11 }
const TEXT = "13"
const SIZE = 17
const NOTHING = undefined
const NONE = null
function bump(): number { COUNT += STEP; STEP = STEP + 1; return COUNT }
function outer(): number { return SIZE }
function inner(): number { const SIZE = 19; return SIZE }
function named(SIZE: number): number { return SIZE + 1 }
function nested(): number { { const SIZE = 23; if (SIZE > 0) return SIZE + outer() } return 0 }
function rest(): string { return [MADE, HEAD, NEXT, DEEP, TEXT, String(NOTHING), String(NONE)].join() }
function later(): () => number { const SIZE = COUNT; return () => SIZE }
(globalThis as any).kit = { bump, outer, inner, named, nested, rest, later }
const kit = (globalThis as any).kit
for (let round = 0; round < 3; round++) console.log(kit.bump(), kit.outer(), kit.inner(), kit.named(round), kit.nested(), kit.rest(), kit.later()(), COUNT, STEP)
