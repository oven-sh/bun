// What `stat()` of node:fs resolves with stands in one arm of a conditional and a literal of a structural type in the other.
declare const console: { log(...values: unknown[]): void };
// node:fs's Stats where a structural type { isDirectory(): boolean } is expected: the two arms of a conditional.
import { stat } from 'node:fs/promises'
async function mine(_p: string): Promise<{ isDirectory(): boolean }> { return { isDirectory: () => false } }
async function f(local: boolean, p: string) {
  const s = local ? await mine(p) : await stat(p)
  return s.isDirectory()
}
console.log(await f(false, '.'), await f(true, '.'))
