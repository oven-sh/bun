// Copies of lists with names, kept and let go while much else is allocated: each must still hold what it was given.
function named(elements: any, pos: number): any {
  const nodes = elements.slice()
  nodes.pos = pos
  nodes.owner = { pos }
  nodes.text = "t" + pos
  nodes.flags = pos & 7
  return nodes
}
const kept: any[] = []
let garbage: unknown[] = []
for (let turn = 0; turn < 60000; turn++) {
  const list: unknown[] = []
  for (let i = 0; i <= turn % 4; i++) list.push({ at: turn + i })
  const nodes = named(list, turn)
  if (turn % 7 === 0) kept.push(nodes)
  if (turn % 11 === 0 && kept.length) { const old = kept[(turn * 13) % kept.length]; old.push({ at: old.pos + old.length }); if (turn % 33 === 0) old.extra = { of: old.pos } }
  garbage.push([turn], "g" + turn)
  if (turn % 300 === 0) garbage = []
}
let sum = 0
for (const nodes of kept) {
  if (nodes.owner.pos !== nodes.pos || nodes.text !== "t" + nodes.pos || nodes.flags !== (nodes.pos & 7)) throw new Error("a name is not what it was")
  for (let i = 0; i < nodes.length; i++) if (nodes[i].at !== nodes.pos + i) throw new Error("an element is not what it was")
  if (nodes.extra && nodes.extra.of !== nodes.pos) throw new Error("the fifth name is not what it was")
  sum += nodes.length
}
console.log(kept.length, sum)
