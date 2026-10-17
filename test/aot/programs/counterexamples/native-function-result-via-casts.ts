// `JSON.parse` is reached through casts and called under a function type of the program.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Parse = (data: string, offset?: number) => { values: unknown[]; error: null | Error; read: number; done: boolean }
function get(): Parse | undefined { const j = (globalThis as Record<string, unknown>).JSON as Record<string, unknown> | undefined; return j?.parse as Parse | undefined }
function run<T>(data: string, p: Parse): T[] { const len = data.length; const result = p(data); if (!result.error || result.done || result.read >= len) return result.values as T[]; return [] }
row("the result of a NATIVE function that was reached through casts", () => run('{"values":[1,2],"error":null,"read":5,"done":true}', get()!).length);
