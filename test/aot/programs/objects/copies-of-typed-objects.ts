// Whole-object copies of typed objects: spread, rest patterns and Object.assign print what plain Bun prints, for fields of every representation and for objects whose keys changed.
const tag = Symbol("tag")
const added = Symbol("added")
interface Rich { count: number; ratio: number; big: number; flag: boolean; name: string; mode: "a" | "b"; present?: string; absent?: string; inner: { id: number }; f: () => number; [tag]: string }
interface Note { id: number; note?: string; size?: number }
interface Wide { f0: number; f1: number; f2: number; f3: number; f4: number; f5: number; f6: number; f7: number; f8: number; f9: number; f10: string; f11: string; f12: string; f13: string; f14: string; f15: boolean; f16: boolean; f17?: number; f18?: string; f19: { id: number } }
interface Trio { first: number; second: number; third?: number }
function keys(o: object): string { return Reflect.ownKeys(o).map(String).join() }
function text(o: object): string { return JSON.stringify(o) + " " + keys(o) }
function repeat(label: string, copy: () => object): void {
  let last: object = {}
  for (let i = 0; i < 2000; i++) last = copy()
  console.log(label, text(last))
}
function makeRich(count: number, ratio: number, big: number): Rich {
  return { count, ratio, big, flag: count > 0, name: "rich", mode: "b", present: "here", inner: { id: count }, f: () => 7, [tag]: "tagged" }
}
function makeWide(): Wide {
  return { f0: 0, f1: 1.5, f2: 2 ** 31, f3: 3, f4: 4, f5: 5, f6: 6, f7: 7, f8: 8, f9: 9.25, f10: "a", f11: "b", f12: "c", f13: "d", f14: "e", f15: true, f16: false, f18: "r", f19: { id: 19 } }
}
function copyEveryWay(label: string, o: Rich): void {
  const untyped: any = o
  repeat(label + " spread", () => { const copy: Rich = { ...o }; return copy })
  repeat(label + " spread any", () => ({ ...untyped }))
  repeat(label + " rest", () => { const { count, ...rest } = o; return rest })
  repeat(label + " rest any", () => { const { ratio, mode, ...rest } = untyped; return rest })
  repeat(label + " assign", () => Object.assign({}, o))
}
function checkRepresentations(count: number, ratio: number, big: number): void {
  const o = makeRich(count, ratio, big)
  const copy: Rich = { ...o }
  console.log(copy.count, copy.ratio, copy.big, copy.flag, copy.name, copy.mode, copy.present, copy.absent, "absent" in copy, copy[tag])
  console.log(copy.inner === o.inner, copy.f === o.f, copy.f(), copy !== o)
  copy.count = 2 ** 32
  copy.big = 0.5
  copy.inner = { id: 99 }
  console.log(o.count, o.big, o.inner.id, copy.count, copy.big, copy.inner.id)
  const plain: any = { ...(o as any) }
  console.log(plain.f === o.f, plain.inner === o.inner, plain.big, Object.getPrototypeOf(plain) === Object.prototype)
}

checkRepresentations(1, 1.5, 2 ** 31)
checkRepresentations(-1, -0, NaN)
checkRepresentations(2 ** 31, 1e300, -(2 ** 31))
copyEveryWay("rich", makeRich(1, 1.5, 2 ** 31))

const wide = makeWide()
repeat("wide spread", () => { const copy: Wide = { ...wide }; return copy })
repeat("wide rest", () => { const { f2, f10, ...rest } = wide; return rest })
repeat("wide assign", () => Object.assign({}, wide))
const wideCopy: Wide = { ...wide }
wideCopy.f2 = 2 ** 33
console.log(wide.f2, wideCopy.f2, wideCopy.f1, wideCopy.f19 === wide.f19, wideCopy.f17, wideCopy.f18)

const withExtra = makeRich(2, 2.5, 2 ** 40);
(withExtra as any).extra = 1
copyEveryWay("extra", withExtra)

const late: Note = { id: 1 }
late.note = "late"
late.size = 1.5
const reversed: Note = { note: "first", id: 2 }
reversed.size = 3
for (const o of [late, reversed]) {
  repeat("late spread", () => { const copy: Note = { ...o }; return copy })
  repeat("late rest", () => { const { id, ...rest } = o; return rest })
  repeat("late assign", () => Object.assign({}, o))
}

const described = makeRich(3, 3.5, 2 ** 31)
const readings: string[] = []
Object.defineProperty(described, "early", { get() { readings.push("early"); return readings.length }, enumerable: true, configurable: true })
Object.defineProperty(described, "hidden", { value: "hidden", enumerable: false, configurable: true });
(described as any)[added] = "added"
Object.defineProperty(described, "later", { get() { readings.push("later"); return readings.length }, enumerable: true, configurable: true })
const describedCopy: Rich = { ...described }
console.log(text(describedCopy), readings.join(), Object.getOwnPropertyDescriptor(describedCopy, "early")?.value, Object.getOwnPropertyDescriptor(describedCopy, "later")?.get, "hidden" in describedCopy)
console.log(text({ ...(described as any) }), readings.join())
const { name: describedName, ...describedRest } = described
console.log(describedName, text(describedRest), readings.join())
console.log(text(Object.assign({}, described)), readings.join())

const shrinking: Trio = { first: 1, second: 2, third: 3 }
Object.defineProperty(shrinking, "removing", { get() { delete this.second; delete this.after; return "removed" }, enumerable: true, configurable: true });
(shrinking as any).after = "after"
const shrunk: Trio = { ...shrinking }
console.log(text(shrunk), text(shrinking))

const frozen = Object.freeze(makeRich(4, 4.5, 2 ** 31))
const frozenCopy: Rich = { ...frozen }
frozenCopy.count = 5
console.log(Object.isFrozen(frozen), Object.isFrozen(frozenCopy), frozen.count, frozenCopy.count, text(frozenCopy))
const frozenExtra: any = makeRich(5, 5.5, 2 ** 31)
frozenExtra.extra = 1
Object.freeze(frozenExtra)
const frozenExtraCopy: Rich = { ...(frozenExtra as Rich) };
(frozenExtraCopy as any).extra = 2
console.log(Object.isFrozen(frozenExtraCopy), frozenExtra.extra, (frozenExtraCopy as any).extra, text(frozenExtraCopy))
const sealed = Object.seal(makeRich(6, 6.5, 2 ** 31))
const sealedRest = (({ flag, ...rest }) => rest)(sealed)
console.log(Object.isSealed(sealedRest), text(sealedRest))

const seventy = {
  p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5, p6: 6, p7: 7, p8: 8, p9: 9,
  p10: 10, p11: 11, p12: 12, p13: 13, p14: 14, p15: 15, p16: 16, p17: 17, p18: 18, p19: 19,
  p20: 20, p21: 21, p22: 22, p23: 23, p24: 24, p25: 25, p26: 26, p27: 27, p28: 28, p29: 29,
  p30: 30, p31: 31, p32: 32, p33: 33, p34: 34, p35: 35, p36: 36, p37: 37, p38: 38, p39: 39,
  p40: 40, p41: 41, p42: 42, p43: 43, p44: 44, p45: 45, p46: 46, p47: 47, p48: 48, p49: 49,
  p50: 50, p51: 51, p52: 52, p53: 53, p54: 54, p55: 55, p56: 56, p57: 57, p58: 58, p59: 59,
  p60: 60, p61: 61, p62: 62, p63: 63, p64: 64, p65: 65, p66: 66, p67: 67, p68: 68, p69: 69,
}
repeat("seventy spread", () => ({ ...seventy }))
repeat("seventy rest", () => { const { p0, p69, ...rest } = seventy; return rest })
repeat("seventy assign", () => Object.assign({}, seventy))

const sparse: Note = { id: 8 }
repeat("excluded absent", () => { const { note, ...rest } = sparse; return rest })
repeat("excluded unknown", () => { const { missing, ...rest } = sparse as any; return rest })
function excludeRope(o: Rich, suffix: string): object {
  const key: string = "na" + suffix
  const { [key]: excluded, ...rest } = o as any
  return rest
}
repeat("excluded rope", () => excludeRope(makeRich(7, 7.5, 2 ** 31), "me"))

class Secret {
  #hidden = 1
  #method() { return this.#hidden }
  shown = 2
  late?: string
  read() { return this.#method() }
}
const secret = new Secret()
const secretCopy: any = { ...secret }
console.log(text(secretCopy), secret.read(), typeof secretCopy.read, Object.getPrototypeOf(secretCopy) === Object.prototype)
try { Secret.prototype.read.call(secretCopy) } catch (e) { console.log((e as Error).name) }
repeat("secret rest", () => { const { shown, ...rest } = secret; return rest })

function copyNote(o: Note): Note { return { ...o } }
for (let i = 0; i < 1000; i++) copyNote({ id: i, note: "n" })
const deleted: Note = { id: -1, note: "gone" }
delete (deleted as any).note
console.log(text(copyNote(deleted)), "note" in copyNote(deleted), text(copyNote({ id: 1001, note: "n" })))

export {}
