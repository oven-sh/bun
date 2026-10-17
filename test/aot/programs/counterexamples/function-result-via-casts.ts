// A function is taken out of a `Record<string, unknown>` by a cast, and what it returns is parsed JSON.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
type Parse = (data: string, offset?: number) => { values: unknown[]; error: null | Error; read: number; done: boolean }
const host: Record<string, unknown> = { parseChunk: hide((data: string) => parse('{"values":[1,2],"error":null,"read":' + data.length + ',"done":true}')) };
function get(): Parse | undefined { return host.parseChunk as Parse | undefined }
function run<T>(data: string, p: Parse): T[] { const len = data.length; const result = p(data); if (!result.error || result.done || result.read >= len) return result.values as T[]; return [] }
row("the result of a host function that was reached through casts", () => run("abc", get()!).length);
