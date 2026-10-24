// Stack traces and unwinding through functions with inlined calls give the same result the first time and every later time.
declare const console: { log(...args: unknown[]): void }
function say(label: string, value: unknown): void { console.log(label + ": " + String(value)) }
function shape(e: unknown): string { return String((e as Error).stack).split("\n").map(l => /^(?:\s*at\s+)?(?:async\s+)?(?:([A-Za-z_$][\w$]*)(?: \(|@))?.*?:(\d+):\d+\)?$/.exec(l)).filter(m => m && m[1] && m[1] !== "module").map(m => m![1] + "@" + m![2]).slice(0, 9).join(" ") }
let mode = 0
function small(x: number): number { return x + 1 }
function leaf(x: number): number { if (mode === 1) throw new Error("leaf"); if (mode === 2) throw { thrown: x }; return small(x) }
function inner(x: number): number { return leaf(x) + 1 }
function withInlined(x: number): number { const a = small(x); return deep(a) + small(a) }
function deep(x: number): number { let s = 0; for (let i = 0; i < 2; i++) s += middle(x + i); return s }
function middle(x: number): number { return inner(x) + small(x) }
function catchesInItself(x: number): string { try { return "no " + withInlined(x) } catch (e) { return e instanceof Error ? shape(e) : "object " + (e as any).thrown } }
function tiny(x: number): string { try { return "no " + withInlined(x) } catch (e) { return "tiny " + (e instanceof Error ? shape(e) : (e as any).thrown) } }
function catchesInAnInlinedBody(x: number): string { return tiny(x) + " | " + small(x) }
function passes(x: number): number { return withInlined(x) + small(x) }
function outer(x: number): string { try { return "no " + passes(x) } catch (e) { return e instanceof Error ? shape(e) : "object " + (e as any).thrown } }
const table: ((x: number) => string)[] = [catchesInItself, catchesInAnInlinedBody, outer]
for (const m of [1, 2, 0]) { mode = m
  for (const f of table) { const seen: string[] = []; for (let turn = 0; turn < 5; turn++) seen.push(f(turn === 4 ? 0 : 0)); say("mode " + m + " " + f.name, seen[0]); say("   the later four are the first", seen.every(s => s === seen[0])) } }
async function waits(x: number): Promise<number> { await null; return passes(x) }
async function main(): Promise<void> { mode = 1; const seen: string[] = []; for (let turn = 0; turn < 4; turn++) { try { await waits(1) } catch (e) { seen.push(shape(e).replace(/( waits@\d+).*$/, "$1")) } } say("behind an await, as far as the function that awaited", seen[0]); say("   the later three are the first", seen.every(s => s === seen[0]))
  mode = 1; const o: any = {}; const taken: string[] = []; function cut(x: number): number { try { return passes(x) } catch (e) { (Error as any).captureStackTrace(o, cut); taken.push(shape(o)); return 0 } } for (let turn = 0; turn < 3; turn++) cut(1); say("captureStackTrace above a function with inlined bodies", taken[0]); say("   the later two are the first", taken.every(s => s === taken[0])) }
main()
