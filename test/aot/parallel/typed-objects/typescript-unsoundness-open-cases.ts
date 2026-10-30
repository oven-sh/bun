// Unsoundness of TypeScript's type system where the rules do not yet say whether the compiled program throws. typed-objects/typescript-unsoundness has the cases that are decided.
const row = (what: string, f: () => unknown) => { let said: string; try { said = String(f()) } catch (e) { said = "THROWS " + (e as Error).constructor.name } console.log(what + ": " + said) }
const kindOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v)
type Point = { x: number; y: number; tag?: string }
const hidden: any = { text: "twelve", nothing: undefined }
// a call of push with `any`, and a callback of map, on an array with written contents
row("any to an element", () => { const list: number[] = [1]; list.push(hidden.text); list[2] = hidden.nothing; return list.map(kindOf).join() })
row("an array of numbers looked at as more", () => { const numbers: number[] = [1]; const wider: (number | string)[] = numbers; wider.push("two"); return numbers.map(n => kindOf(n) + (n + 1)).join() })
// values of declarations without a body
declare function hostValue(): Point
declare const hostConfig: { retries: number; names: string[] }
;(globalThis as any).hostValue = () => ({ x: "left" })
;(globalThis as any).hostConfig = { retries: "3" }
row("what a declared function yields", () => { const p = hostValue(); return kindOf(p.x) + ":" + kindOf(p.y) })
row("a declared constant", () => kindOf(hostConfig.retries) + ":" + kindOf(hostConfig.names))
// overloads that lie
function pick(kind: "n"): number
function pick(kind: "s"): string
function pick(kind: string): unknown { return kind === "n" ? "not a number" : 5 }
row("an overload that lies", () => { const n = pick("n"), s = pick("s"); return kindOf(n) + ":" + kindOf(s) + ":" + (n + 1) })
export {}
