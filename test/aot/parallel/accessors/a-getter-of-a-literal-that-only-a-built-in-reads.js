// A getter or a setter of an object literal that no code in sight reads: only a built-in reads it, one whose row runs the own values of its operand. Link enters an accessor that is laid on a field of a record
// only once the field is asked (an edge, an observer or an arrival), so a row that reads every named value and neither moves them on nor follows them would leave the body out. No row does today: those that
// are not transitive move the values, read by position (an accessor under a number is entered at once), or read under a key that the row names or is handed. Each literal has names of its own, so that no other
// part asks its fields. Not here: spyOn and stubGlobal of bun:test, which need a test run.
const n = JSON.parse("3");
const log = [];
const say = s => (log.push(s), n);
const parts = [
  () => Array.prototype.includes.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, 7),
  () => Array.prototype.indexOf.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, 7),
  () => Array.prototype.lastIndexOf.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, 7),
  () => Array.prototype.fill.call({ length: 2, get 0() { return say("zero"); }, set 0(value) { say("set zero"); }, get 1() { return say("one"); }, set 1(value) { say("set one"); } }, 7).length,
  () => Array.prototype.push.call({ get length() { return say("length"); }, set length(value) { say("set length"); } }, 7),
  () => Array.prototype.unshift.call({ length: 2, set 2(value) { say("set two"); }, get 0() { return say("zero"); }, set 0(value) { say("set zero"); }, get 1() { return say("one"); }, set 1(value) { say("set one"); } }, 7),
  () => Array.prototype.copyWithin.call({ length: 2, get 0() { return say("zero"); }, set 0(value) { say("set zero"); }, get 1() { return say("one"); }, set 1(value) { say("set one"); } }, 0, 1).length,
  () => Array.prototype.reverse.call({ length: 2, get 0() { return say("zero"); }, set 0(value) { say("set zero"); }, get 1() { return say("one"); }, set 1(value) { say("set one"); } }).length,
  () => Array.prototype.every.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, x => x > 0),
  () => Array.prototype.some.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, x => x > 100),
  () => Array.prototype.findIndex.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, x => x > 100),
  () => Array.prototype.findLastIndex.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, x => x > 100),
  () => Array.prototype.forEach.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, x => {}),
  () => Array.prototype.forEach.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, () => {}),
  () => Array.prototype.map.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, () => 1).length,
  () => Array.prototype.flatMap.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, () => 1).length,
  () => Array.prototype.reduce.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, (sum) => sum + 1, 0),
  () => Array.prototype.reduceRight.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, (sum) => sum + 1, 0),
  () => [].concat({ length: 1, [Symbol.isConcatSpreadable]: true, get 0() { return say("zero"); } }).length,
  () => Array.from({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }).length,
  () => Array.from({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, () => 1).length,
  () => typeof Object.assign({}, { get a21() { return say("a21"); }, get b21() { return say("b21"); } }),
  () => typeof Object.assign(Object(n), { get a22() { return say("a22"); }, get b22() { return say("b22"); } }),
  () => typeof Object.assign({ set a23(value) { say("set a23"); } }, { a23: 1 }),
  () => typeof Object.getOwnPropertyDescriptor({ get a24() { return say("a24"); }, get b24() { return say("b24"); } }, "a24").get,
  () => Object.getOwnPropertyDescriptor({ get a25() { return say("a25"); }, get b25() { return say("b25"); } }, "a25").get(),
  () => Object.getOwnPropertyDescriptors({ get a26() { return say("a26"); }, get b26() { return say("b26"); } }).b26.get(),
  () => Reflect.get({ get a27() { return say("a27"); }, get b27() { return say("b27"); } }, "a27"),
  () => Reflect.get({ get a28() { return say("a28"); }, get b28() { return say("b28"); } }, JSON.parse('"a28"')),
  () => Reflect.getOwnPropertyDescriptor({ get a29() { return say("a29"); }, get b29() { return say("b29"); } }, JSON.parse('"a29"')).get(),
  () => Object.entries({ get a30() { return say("a30"); }, get b30() { return say("b30"); } }).length,
  () => Object.values({ get a31() { return say("a31"); }, get b31() { return say("b31"); } }).length,
  () => Math.max.apply(null, { length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }),
  () => Reflect.apply(Math.max, null, { length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }),
  () => Reflect.construct(Array, { length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }).length,
  () => Array.prototype.at.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, 1),
  () => Array.prototype.slice.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }).length,
  () => Array.prototype.pop.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }),
  () => Array.prototype.shift.call({ length: 2, get 0() { return say("zero"); }, set 0(value) { say("set zero"); }, get 1() { return say("one"); }, set 1(value) { say("set one"); } }),
  () => Array.prototype.with.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }, 0, 1).length,
  () => Array.prototype.toReversed.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }).length,
  () => Array.prototype.join.call({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }),
  () => Bun.color({ get r() { return say("r"); }, get g() { return say("g"); }, get b() { return say("b"); } }, "css"),
  () => JSON.stringify({ get a45() { return say("a45"); }, get b45() { return say("b45"); } }),
  () => Object.keys(structuredClone({ get a46() { return say("a46"); }, get b46() { return say("b46"); } })).length,
  () => "a47" in { ...{ get a47() { return say("a47"); }, get b47() { return say("b47"); } } },
  () => Bun.deepEquals({ get a48() { return say("a48"); }, get b48() { return say("b48"); } }, { a48: 3, b48: 3 }),
  () => Bun.inspect({ get a49() { return say("a49"); }, get b49() { return say("b49"); } }),
  () => new Map([{ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }]).size,
  () => Object.keys(Object.fromEntries([{ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }])).length,
  () => Uint8Array.from({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }).length,
  () => (() => { const view = new Uint8Array(4); view.set({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }); return view.join(); })(),
  () => new Uint8Array({ length: 2, get 0() { return say("zero"); }, get 1() { return say("one"); } }).join(),
  () => String.raw({ get raw() { say("raw"); return ["x"]; } }),
  () => typeof Object.defineProperties({}, { get a56() { say("a56"); return { value: 1 }; } }),
  () => typeof Object.create(null, { get a57() { say("a57"); return { value: 1 }; } }),
  () => typeof Object.defineProperty({}, "x", { get value() { return say("value"); } }),
  () => typeof new Intl.NumberFormat("en", { get style() { say("style"); return "decimal"; } }).format(1),
  () => ["a"].toLocaleString("en", { get style() { say("style"); return undefined; } }),
];
for (let turn = 0; turn < 2; ++turn) {
  for (const part of parts) {
    try {
      console.log(String(part()));
    } catch (error) {
      console.log(error.constructor.name + ": " + error.message);
    }
  }
}
console.log(log.join());
