// The awaited value is a built-in promise that never escapes.
async function list(n: number) { const a: number[] = []; for (let i = 0; i < n; i++) a.push(i); return a }
async function table() { return new Map([["a", 1]]) }
async function use() {
  const a = await list(3)
  const m = await table()
  return a.length + m.size + a.filter(x => x > 0).length
}
console.log(await use())
