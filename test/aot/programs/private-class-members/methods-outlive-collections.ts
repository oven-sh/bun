// Private methods and accessors stay callable across collections after the program drops its references to their classes, and each class evaluation has its own.
const host = globalThis as any
const collect = host.Bun ? (full: boolean) => host.Bun.gc(full) : (full: boolean) => (full ? host.fullGC() : host.edenGC())
function resultText(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
function show(...parts: unknown[]): void { console.log(parts.join(" | ")) }

const logged: unknown[] = []
function makeClass(n: number) {
  return class {
    #m(): number { return n }
    get #g(): number { return n }
    set #g(v: number) { logged.push(v) }
    static #s(): number { return n }
    method(): unknown { return this.#m }
    static call(o: any): unknown[] { return [o.#m(), o.#g, (o.#g = 1), #m in o] }
    static own(): number { return this.#s() }
    static storeMethod(o: any): void {
      // @ts-ignore
      o.#m = 1
    }
    static storeStaticMethod(): void {
      // @ts-ignore
      this.#s = 1
    }
  }
}

type RetainedClass = { n: number, call: (o: any) => unknown[], instance: object }
const retainedClasses: RetainedClass[] = []
for (let n = 0; n <= 2000; n++) {
  const C = makeClass(n)
  if (n % 100 !== 0) continue
  const instance = new C()
  delete (Object.getPrototypeOf(instance) as any).constructor
  retainedClasses.push({ n, call: C.call, instance })
}
for (let i = 0; i < 3; i++) collect(true)
for (const { n, call, instance } of retainedClasses) show(n, resultText(() => call(instance)))
show("setter calls", logged.length)
show("another evaluation's instance", resultText(() => retainedClasses[0].call(retainedClasses[1].instance)))

const C1 = makeClass(1), C2 = makeClass(2)
const first = new C1(), second = new C2()
show("static method", C1.own(), C2.own())
show("instance of another evaluation", resultText(() => C1.call(second)))
show("plain object", resultText(() => C1.call({})))
show("store to a method", resultText(() => C1.storeMethod(first)))
show("store to a static method", resultText(() => C1.storeStaticMethod()))
show("functions of two evaluations", first.method() === second.method(), first.method() === new C1().method())

class Accessors {
  get #onlyGet(): number { return 2 }
  set #onlySet(v: number) { logged.push(v) }
  static storeGetter(o: any): void {
    // @ts-ignore
    o.#onlyGet = 1
  }
  static readSetter(o: any): unknown { return o.#onlySet }
}
show("store to a getter", resultText(() => Accessors.storeGetter(new Accessors())))
show("read of a setter", resultText(() => Accessors.readSetter(new Accessors())))

class Identity { constructor(o: object) { return o } }
class Stamped extends Identity {
  #stamp(): number { return 1 }
  static has(o: object): boolean { return #stamp in o }
}
const target = {}
show("first add", resultText(() => new Stamped(target) === target), Stamped.has(target))
show("second add", resultText(() => new Stamped(target)))
export {}
