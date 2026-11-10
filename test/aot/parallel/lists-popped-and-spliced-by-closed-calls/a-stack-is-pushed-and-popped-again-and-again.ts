// `stack.pop()` where the call is closed: the stub takes the last element of a plain vector and enters no operation.
// COUNT: operation:operationAOTArrayPopGeneric <= 60
const holders: any[] = [{ stack: [] as unknown[] }, { stack: [] as number[] }, { stack: ["a"] as string[] }]
let sum = 0
for (let turn = 0; turn < 3000; turn++) {
  for (const holder of holders) {
    holder.stack.push(turn, turn + 1)
    const last = holder.stack.pop()
    const before = holder.stack.pop()
    sum += last - before
    if (turn % 1000 === 0) sum += holder.stack.length
  }
}
const emptied: any = { stack: [1] }
console.log(sum, emptied.stack.pop(), emptied.stack.pop(), emptied.stack.pop(), emptied.stack.length, holders.map(holder => holder.stack.length).join())
