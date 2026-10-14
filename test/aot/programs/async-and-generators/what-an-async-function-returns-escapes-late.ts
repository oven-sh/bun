// What an async function returns escapes only after the function has been analyzed: what is awaited has to be looked at again.
interface Box { value: number }
async function make(n: number): Promise<Box> { return { value: n } }
async function use(n: number): Promise<number> {
  const box = await make(n)
  return box.value
}
console.log(await use(1))
const kept: Box = await make(2)
;(globalThis as any).leak = kept
;(globalThis as any).leak.value = 40
console.log(kept.value + (await use(2)))
