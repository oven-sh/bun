// `const nodes = list.slice(); nodes.pos = ..`, the call closed: the copy is born with room for its first named properties, and the store that adds the first enters no operation.
// COUNT: operation:operationAOTAddPropertyBySlot <= 400
function named(elements: any, pos: number, trailing?: boolean): any {
  const length = elements.length
  const nodes = length >= 1 && length <= 4 ? elements.slice() : elements
  nodes.pos = pos
  nodes.end = pos + length
  nodes.hasTrailingComma = !!trailing
  nodes.flags = 0
  return nodes
}
const kept: any[] = []
let sum = 0
for (let turn = 0; turn < 20000; turn++) {
  const list: unknown[] = []
  for (let i = 0; i <= turn % 4; i++) list.push(turn % 3 ? { at: i } : i)
  const nodes = named(list, turn, turn % 2 === 0)
  sum += nodes.pos + nodes.end + nodes.length + (nodes.hasTrailingComma ? 1 : 0) + nodes.flags
  if (nodes === list) throw new Error("no copy")
  if (turn % 500 === 0) kept.push(nodes)
}
for (const nodes of kept) {
  nodes.push("more", "and more", "and still more", "and yet more")
  nodes.fifth = nodes.length
  sum += nodes.fifth + nodes.pos + Object.keys(nodes).length
}
console.log(sum, kept.length, JSON.stringify(kept[1]), Object.keys(kept[1]).join(), kept[1].end)
