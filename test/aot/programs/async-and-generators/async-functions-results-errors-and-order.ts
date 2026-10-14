// Async functions: results, errors, and the exact order in which everything runs.
const log: string[] = []
const say = (s: string) => { log.push(s) }
async function plain(n: number): Promise<number> { say("plain " + n); return n * 2 }
async function one(n: number): Promise<number> { say("one in"); const a = await plain(n); say("one mid " + a); const b = await 5; say("one out"); return a + b }
async function failing(): Promise<number> { say("failing in"); await null; say("failing throws"); throw new Error("bad") }
async function catching(): Promise<string> {
  try { await failing(); return "no" } catch (e) { say("caught " + (e as Error).message); return "yes" } finally { say("finally") }
}
async function loop(k: number): Promise<number> { let t = 0; for (let i = 0; i < k; i++) { t += await plain(i); if (i === 1) continue } return t }
async function operands(): Promise<string> { const f = (a: number, b: number, c: number) => a + "," + b + "," + c; let x = 1; return f(x++, await plain(x), x++) + ";" + (x + (await plain(10)) + x) }
async function thenable(): Promise<number> { return await ({ then(resolve: (v: number) => void) { say("then called"); resolve(7) } } as any) }
async function rejected(): Promise<string> { try { await Promise.reject(new Error("r")) } catch (e) { return (e as Error).message } return "none" }
class Service {
  base = 100
  async get(n: number): Promise<number> { await null; return this.base + n }
  all = async (list: number[]): Promise<number[]> => { const out: number[] = []; for (const n of list) out.push(await this.get(n)); return out }
}
say("start")
one(1).then(v => say("one = " + v))
Promise.resolve().then(() => say("tick 1")).then(() => say("tick 2")).then(() => say("tick 3")).then(() => say("tick 4"))
catching().then(v => say("catching = " + v))
loop(3).then(v => say("loop = " + v))
operands().then(v => say("operands = " + v))
thenable().then(v => say("thenable = " + v))
rejected().then(v => say("rejected = " + v))
new Service().all([1, 2]).then(v => say("all = " + v.join()))
failing().catch(e => say("outer " + e.message))
const p = plain(9)
say("is promise " + (p instanceof Promise) + " " + Object.prototype.toString.call(p))
Promise.all([plain(1), one(2), 3]).then(v => say("Promise.all " + v.join()))
say("end of script")
setTimeout(() => console.log(log.join("\n")), 0)
