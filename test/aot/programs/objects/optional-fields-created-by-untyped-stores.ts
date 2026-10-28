// Untyped stores create optional fields until the creations are warm, then meet prototypes and objects where a warm creation must not apply.
// COUNTER: StoreOfOtherType >= 1
// COUNTER: FieldCreationNotRecorded >= 1
interface R { a: number; b?: number; c?: string }
interface Wide { a?: number; b?: number; c?: number; d?: number; e?: number; f?: number }
class K { x = 1; declare y?: number }
class Deep0 { base = 0; declare y?: number }
class Deep1 extends Deep0 {}
class Deep2 extends Deep1 {}
class Deep3 extends Deep2 {}
class Deep4 extends Deep3 {}

const host: any = globalThis
const collect = host.Bun ? (full: boolean) => host.Bun.gc(full) : (full: boolean) => (full ? host.fullGC() : host.edenGC())
const rounds = 20000

function createR(): R { return { a: 1 } }
function createWide(): Wide { return {} }
function setA(o: any, v: any) { o.a = v }
function setB(o: any, v: any) { o.b = v }
function setC(o: any, v: any) { o.c = v }
function setD(o: any, v: any) { o.d = v }
function setE(o: any, v: any) { o.e = v }
function setF(o: any, v: any) { o.f = v }
function setExtra(o: any, v: any) { o.extra = v }
function setY(o: any, v: any) { o.y = v }
function setDeepY(o: any, v: any) { o.y = v }
// Class code is always strict. Plain Bun's transpiler drops a "use strict" directive inside a function, which would leave the reference run without a strict store.
class StrictCode {
  static setB = function (o: any, v: any) { o.b = v }
  static setY = function (o: any, v: any) { o.y = v }
}
const setBStrict = StrictCode.setB
const setYStrict = StrictCode.setY

function report(label: string, objects: any[]) {
  let total = 0
  for (const o of objects) total += o.b
  const sample = objects[objects.length - 1]
  console.log(label, total, Object.keys(sample).join(), JSON.stringify(sample))
}

function fillBThenC(withExtra: boolean): any[] {
  const objects: any[] = []
  for (let i = 0; i < rounds; i++) {
    const o = createR()
    if (withExtra) setExtra(o, i)
    setB(o, i)
    setC(o, "c" + (i % 7))
    objects.push(o)
  }
  return objects
}

function fillCThenB(withExtra: boolean): any[] {
  const objects: any[] = []
  for (let i = 0; i < rounds; i++) {
    const o = createR()
    if (withExtra) setExtra(o, i)
    setC(o, "c" + (i % 7))
    setB(o, i)
    objects.push(o)
  }
  return objects
}

report("b then c", fillBThenC(false))
report("c then b", fillCThenB(false))
report("late b then c", fillBThenC(true))
report("late c then b", fillCThenB(true))

const wideOrders = [
  [setA, setB, setC, setD, setE, setF],
  [setA, setB, setC, setE, setD, setF],
  [setA, setB, setD, setC, setE, setF],
  [setA, setC, setB, setD, setE, setF],
  [setB, setA, setC, setD, setE, setF],
  [setC, setA, setB, setD, setE, setF],
  [setD, setA, setB, setC, setE, setF],
  [setE, setA, setB, setC, setD, setF],
  [setE, setD, setC, setB, setA, setF],
]
for (let pass = 0; pass < 2; pass++) {
  for (const order of wideOrders) {
    let o: any = createWide()
    for (let i = 0; i < 400; i++) {
      o = createWide()
      let value = i
      for (const set of order) set(o, value++)
    }
    console.log("wide", pass, Object.keys(o).join(), o.f)
  }
}

function warmK(): number {
  let total = 0
  for (let i = 0; i < rounds; i++) {
    const sloppy: any = new K()
    const strict: any = new K()
    setY(sloppy, i)
    setYStrict(strict, 1)
    total += sloppy.y + strict.y
  }
  return total
}

function errorName(action: () => void): string {
  try {
    action()
    return "no error"
  } catch (error: any) {
    return error.constructor.name
  }
}

console.log("warm", warmK())
const seen: any[] = []
Object.defineProperty(K.prototype, "y", { configurable: true, set(v: any) { seen.push(v) } })
const withSetter: any = new K()
setY(withSetter, 7)
setYStrict(withSetter, 8)
console.log("setter", seen.join(), Object.keys(withSetter).join())
delete (K.prototype as any).y

console.log("warm", warmK())
Object.defineProperty(K.prototype, "y", { configurable: true, writable: false, value: 5 })
const readOnly: any = new K()
console.log("read-only strict", errorName(() => setYStrict(readOnly, 9)), Object.keys(readOnly).join(), readOnly.y)
setY(readOnly, 9)
console.log("read-only sloppy", Object.keys(readOnly).join(), readOnly.y)
delete (K.prototype as any).y

console.log("warm", warmK())
Object.defineProperty(K.prototype, "y", { configurable: true, writable: true, value: 6 })
const shadowing: any = new K()
setY(shadowing, 10)
console.log("writable", Object.keys(shadowing).join(), shadowing.y, (K.prototype as any).y)
delete (K.prototype as any).y
console.log("warm", warmK())

const integrityChanges: [string, (o: any) => any][] = [
  ["preventExtensions", (o: any) => Object.preventExtensions(o)],
  ["seal", (o: any) => Object.seal(o)],
  ["freeze", (o: any) => Object.freeze(o)],
]
for (const [label, change] of integrityChanges) {
  const o: any = change(createR())
  setB(o, 11)
  console.log(label, "sloppy", Object.keys(o).join(), o.b)
  console.log(label, "strict", errorName(() => setBStrict(o, 12)), Object.keys(o).join(), o.b)
}

const otherType: any = createR()
setB(otherType, "text")
setC(otherType, "after")
console.log("other type", typeof otherType.b, otherType.b, Object.keys(otherType).join())

function warmDeep(): number {
  let total = 0
  for (let i = 0; i < rounds; i++) {
    const o: any = new Deep4()
    setDeepY(o, i)
    total += o.y
  }
  return total
}
console.log("deep", warmDeep())
const seenDeep: any[] = []
Object.defineProperty(Deep0.prototype, "y", { configurable: true, set(v: any) { seenDeep.push(v) } })
const deep: any = new Deep4()
setDeepY(deep, 13)
console.log("deep setter", seenDeep.join(), Object.keys(deep).join())
delete (Deep0.prototype as any).y
console.log("deep", warmDeep())

function dropLateObjects(round: number): number {
  let total = 0
  for (let i = 0; i < 2000; i++) {
    const o: any = createR()
    o["round" + round] = i
    setB(o, i)
    setC(o, "c")
    total += Object.keys(o).length + o.b
  }
  return total
}
for (let round = 0; round < 6; round++) {
  console.log("dropped", round, dropLateObjects(round))
  collect(round % 2 === 1)
}
report("late after collection", fillBThenC(true))
// This store makes the file a CommonJS module, so a function without a "use strict" directive is sloppy.
module.exports = {}
