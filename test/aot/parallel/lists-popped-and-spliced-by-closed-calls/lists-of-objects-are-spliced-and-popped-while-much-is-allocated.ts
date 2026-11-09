// Lists of objects that are inserted into and popped while much else is allocated: every object must still be what it was.
type Item = { id: number; text: string }
const holders: any[] = []
for (let h = 0; h < 40; h++) holders.push({ list: [] as Item[], sum: 0 })
let made = 0
let garbage: unknown[] = []
for (let turn = 0; turn < 4000; turn++) {
  for (const holder of holders) {
    const item: Item = { id: made++, text: "t" + made }
    const at = holder.list.length ? (turn * 7 + item.id) % (holder.list.length + 1) : 0
    const removed = holder.list.splice(at, 0, item)
    if (removed.length !== 0) throw new Error("removed something")
    holder.sum += item.id
    garbage.push({ a: [turn], b: "g" + turn })
    if (holder.list.length > 60) {
      for (let k = 0; k < 30; k++) { const popped: Item = holder.list.pop(); holder.sum -= popped.id; if (popped.text !== "t" + (popped.id + 1)) throw new Error("a popped item is not what it was") }
    }
  }
  if (turn % 50 === 0) garbage = []
}
let left = 0
for (const holder of holders) {
  let sum = 0
  for (const item of holder.list as Item[]) { sum += item.id; if (item.text !== "t" + (item.id + 1)) throw new Error("an item is not what it was") }
  if (sum !== holder.sum) throw new Error("a list lost or gained an item")
  left += holder.list.length
}
console.log(made, left)
