// `receiver.hasOwnProperty(key)` where the call is closed, and the same function called in other ways, over every kind of receiver and of key.
function asks(receiver: any, key: any): unknown { return receiver.hasOwnProperty(key) }
const has = Object.prototype.hasOwnProperty
function asksByCall(receiver: any, key: any): unknown { return (has as any).call(receiver, key) }
function asksByHolder(holder: any, receiver: any, key: any): unknown { return holder.test.call(receiver, key) }
const log: string[] = []
class Point { x = 1; y?: number; get got() { return 1 } static made = 1 }
class Own { hasOwnProperty(key: unknown) { return "mine:" + String(key) } }
const symbol = Symbol("s")
const receivers: [string, () => any][] = [
  ["a literal", () => ({ key: true, ref: true, 0: "zero", [symbol]: 1 })],
  ["empty", () => ({})],
  ["an instance", () => new Point()],
  ["an instance with more", () => Object.assign(new Point(), { y: 2, extra: 3 })],
  ["a name deleted", () => { const o: any = { key: 1, ref: 2 }; delete o.key; return o }],
  ["undefined held", () => ({ key: undefined })],
  ["an accessor", () => ({ get key() { log.push("read"); return 1 } })],
  ["not enumerable", () => Object.defineProperty({}, "key", { value: 1, enumerable: false })],
  ["inherited", () => Object.create({ key: 1 })],
  ["a list", () => ["a", , "c"]],
  ["a list with names", () => Object.assign([1], { key: 1 })],
  ["a function", () => function key() {}],
  ["a class", () => Point],
  ["a map", () => new Map([["key", 1]])],
  ["a text object", () => Object("abc")],
  ["a typed array", () => new Uint8Array(2)],
  ["arguments", () => (function (..._: unknown[]) { return arguments })(1, 2)],
  ["frozen", () => Object.freeze({ key: 1 })],
  ["many names", () => { const o: any = {}; for (let i = 0; i < 40; i++) o["n" + i] = i; o.key = 1; return o }],
  ["a proxy", () => new Proxy({ key: 1 }, { getOwnPropertyDescriptor(target, name) { log.push("trap " + String(name)); return Reflect.getOwnPropertyDescriptor(target, name) } })],
  ["a proxy that throws", () => new Proxy({}, { getOwnPropertyDescriptor() { throw new RangeError("no") } })],
  ["a method of its own", () => new Own()],
  ["a field of that name", () => ({ hasOwnProperty: () => "field" })],
  ["without a prototype", () => Object.assign(Object.create(null), { key: 1 })],
  ["a text", () => "abc"], ["a number", () => 5], ["true", () => true], ["a symbol", () => symbol], ["a big integer", () => 5n], ["null", () => null], ["undefined", () => undefined],
]
const keys: [string, () => any][] = [
  ["key", () => "key"], ["ref", () => "ref"], ["absent", () => "absent"], ["x", () => "x"], ["y", () => "y"], ["got", () => "got"], ["made", () => "made"], ["length", () => "length"], ["name", () => "name"], ["extra", () => "extra"], ["n39", () => "n39"],
  ["joined", () => "ke" + ["y", "z"][log.length % 1]], ["cut", () => "monkeys".slice(3, 6)], ["empty", () => ""], ["0", () => 0], ["1", () => 1], ["2", () => 2], ["text 0", () => "0"], ["-0", () => -0], ["1.5", () => 1.5], ["-1", () => -1], ["2 ** 32", () => 2 ** 32], ["NaN", () => NaN],
  ["a symbol", () => symbol], ["another symbol", () => Symbol("s")], ["undefined", () => undefined], ["null", () => null], ["true", () => true], ["a big integer", () => 1n],
  ["an object", () => ({ toString() { log.push("key converted"); return "key" } })], ["an object that throws", () => ({ toString() { throw new EvalError("key") } })], ["a list", () => ["key"]],
]
const holder = { test: has }
for (let round = 0; round < 3; round++) {
  for (const [name, receiver] of receivers) {
    const answers: string[] = []
    for (const [, key] of keys) {
      for (const ask of [asks, asksByCall, (r: any, k: any) => asksByHolder(holder, r, k)]) {
        try { answers.push(String(ask(receiver(), key()))[0]!) } catch (error) { answers.push((error as Error).constructor.name.slice(0, 2)) }
      }
    }
    console.log(round, name + ":", answers.join(""), log.length)
  }
}
console.log(typeof asks({ key: 1 }, "key"), asks({ key: 1 }, "key") === true, asks({}, "key") === false, log.slice(0, 6).join())
