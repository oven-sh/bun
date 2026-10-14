// `using` and `await using`.
const log: string[] = []
function res(name: string, fails = false) { return { name, [Symbol.dispose]() { log.push("dispose " + name); if (fails) throw new Error("dispose " + name + " failed") } } }
function ares(name: string, fails = false) { return { name, async [Symbol.asyncDispose]() { log.push("async dispose " + name); await null; log.push("async disposed " + name); if (fails) throw new Error(name + " failed") } } }
function plain(): string { using a = res("a"); using b = res("b"); using none = null; log.push("body " + a.name + b.name + none); return "returned" }
console.log(plain(), log.join()); log.length = 0
function early(n: number): number { for (let i = 0; i < 3; i++) { using r = res("r" + i); if (i === n) return i; if (i === 0) continue; log.push("end " + r.name) } return -1 }
console.log(early(1), log.join()); log.length = 0
function throws(): void { using a = res("a", true); using b = res("b", true); throw new Error("body") }
try { throws() } catch (e: any) { console.log(e.name, e.error.message, e.suppressed.name, e.suppressed.error.message, e.suppressed.suppressed.message, log.join()) } log.length = 0
function onlyDispose(): void { using a = res("a", true); log.push("fine") }
try { onlyDispose() } catch (e: any) { console.log(e.message, log.join()) } log.length = 0
try { (function () { using bad = {} as any })() } catch (e: any) { console.log(e.constructor.name) }
async function asyncOnes(): Promise<string> { await using a = ares("a"); using s = res("s"); await using b = ares("b"); log.push("body"); return "async returned" }
async function asyncFails(): Promise<void> { await using a = ares("a", true); throw new Error("async body") }
asyncOnes().then(v => { console.log(v, log.join()); log.length = 0; return asyncFails() }).catch(e => console.log(e.name, e.error.message, e.suppressed.message, log.join()))
