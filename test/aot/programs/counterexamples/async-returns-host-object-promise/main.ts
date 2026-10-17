// An async function whose written result is a structural type returns the promise of a host object in one arm and a literal in the other.
declare const console: { log(...values: unknown[]): void };
import "./helper.js";
declare class Stats { isDirectory(): boolean; isFile(): boolean; size: number }
declare function stat(p: string): Promise<Stats>;
async function probe(own: boolean, p: string): Promise<{ isDirectory(): boolean }> {
  if (!own) return stat(p)
  const kind = p.length > 3 ? 'dir' : 'file'
  return { isDirectory: () => kind === 'dir' }
}
async function f(local: boolean, own: boolean, p: string) {
  let d: boolean | undefined
  try {
    const s = local ? await probe(own, p) : await stat(p)
    d = s.isDirectory()
  } catch (e) { return 'THROWN: ' + (e as Error).message }
  return d
}
console.log(await f(true, true, '/tmp'), await f(true, false, '/tmp'), await f(false, false, '/tmp'))
