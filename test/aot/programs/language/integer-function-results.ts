// A function whose `return` statements all return integers has an integer result.
function width(s: string): number { return s.length & 7 }
const arrow = (s: string): number => s.length >> 1
function either(s: string, flag: boolean): number { if (flag) return s.charCodeAt(0) | 0; return -1 }
function twice(s: string): number { return width(s) + arrow(s) }
function counted(s: string): number { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === "a") n++; return n }
function viaVariable(s: string): number { const w = width(s); const t = twice(s); return w > 3 ? w : t }
function depth(n: number): number { return n <= 0 ? 0 : depth(n - 1) + 1 }
function half(s: string): number { return s.length / 2 }
function handedOn(x: number): number { return x }
function mixed(s: string): number { return s.length > 2 ? 1 : 0.5 }
async function later(s: string): Promise<number> { return s.length }
function maybe(s: string): number | undefined { if (s.length) return s.length; return undefined }
function minusZero(s: string): number { return -(s.length & 0) }
function huge(s: string): number { return s.length * 9007199254740991 }
let swapped = width; if (Number("1")) swapped = arrow
class Box { constructor(public text: string) {} size(): number { return this.text.length & 15 } }
const text = "banana" + Number("7")
console.log(width(text), arrow(text), either(text, true), either(text, false), twice(text), counted(text), viaVariable(text), depth(5))
console.log(half(text), handedOn(1.5), handedOn(2), mixed(text), mixed("a"), maybe(""), maybe(text), Object.is(minusZero(text), -0), huge(text), swapped(text), new Box(text).size())
later(text).then(n => console.log("later", n))
const loose: any = { width, arrow, twice, half }
console.log(loose.width(text), loose.arrow(text), loose.twice(text), loose.half(text), [text, "a"].map(width).join())
