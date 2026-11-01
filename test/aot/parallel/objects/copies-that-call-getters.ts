// Object.assign, spreads and rests of sources with getters. A getter may look at the target and change the source, the target and what stands above the target: each property is read and stored in the order of the language.
const log: string[] = [];
function digest(object: any): string {
  const keys = Reflect.ownKeys(object).map(key => {
    const place = Object.getOwnPropertyDescriptor(object, key)!;
    return String(key) + "=" + String(place.get || place.set ? "accessor" : place.value) + (place.enumerable ? "" : "~") + (place.writable === false ? "!" : "");
  });
  return "{" + keys.join() + "}" + (Object.isExtensible(object) ? "" : " closed");
}
const local = Symbol("local");
let target: any = null;
class Holder { a = 1; z = 26; }

// Each maker gets the target, which the getters of some look at.
const sources: Record<string, () => any> = {
  "in the middle": () => ({ a: 1, get b() { log.push("b"); return 2; }, c: 3, d: 4 }),
  first: () => ({ get a() { log.push("a"); return 1; }, b: 2, c: 3 }),
  last: () => ({ a: 1, b: 2, get c() { log.push("c"); return 3; } }),
  two: () => ({ get a() { log.push("a"); return 1; }, b: 2, get c() { log.push("c"); return 3; }, d: 4 }),
  alone: () => ({ get a() { log.push("a"); return 1; } }),
  "reads this": () => ({ a: 1, b: 2, get sum(): number { return this.a + this.b; } }),
  "setter alone": () => ({ a: 1, set b(value: number) { log.push("set b"); }, c: 3 }),
  "both halves": () => ({ a: 1, get b() { log.push("get b"); return 2; }, set b(value: number) { log.push("set b"); }, c: 3 }),
  "under a symbol": () => ({ a: 1, get [local]() { log.push("local"); return 2; }, c: 3 }),
  hidden: () => Object.defineProperty({ a: 1, c: 3 }, "b", { get() { log.push("b"); return 2; }, enumerable: false }),
  "defined late": () => Object.defineProperty({ a: 1, c: 3 }, "b", { get() { log.push("b"); return 2; }, enumerable: true, configurable: true }),
  "over a field": () => Object.defineProperty({ a: 1, b: 0, c: 3 }, "b", { get() { log.push("b"); return 2; }, enumerable: true, configurable: true }),
  "on an object filled by key": () => { const made: any = {}; for (const name of ["a", "c", "d"]) made[name] = name; return Object.defineProperty(made, "b", { get() { log.push("b"); return 2; }, enumerable: true }); },
  "on a parsed object": () => Object.defineProperty(JSON.parse('{"a":1,"c":3}'), "b", { get() { log.push("b"); return 2; }, enumerable: true }),
  "on a dictionary": () => { const made: any = {}; for (let i = 0; i < 80; i++) made["k" + i] = i; for (let i = 3; i < 80; i++) delete made["k" + i]; return Object.defineProperty(made, "b", { get() { log.push("b"); return 2; }, enumerable: true }); },
  "on an instance": () => Object.defineProperty(new Holder(), "b", { get() { log.push("b"); return 2; }, enumerable: true }),
  "above the source": () => Object.create({ get inherited() { log.push("inherited"); return 0; } }, { own: { value: 1, enumerable: true } }),
  "beside elements": () => ({ a: 1, 0: "zero", get b() { log.push("b"); return 2; }, 1: "one" }),
  "an element": () => Object.defineProperty({ a: 1, 1: "one" }, "0", { get() { log.push("0"); return "zero"; }, enumerable: true }),
  throws: () => ({ a: 1, get b(): number { throw new RangeError("from b"); }, get c() { log.push("c"); return 3; } }),
  "looks at the target": () => ({ a: 1, b: 2, get c() { log.push(target ? Object.keys(target).join("+") : "none"); return 3; }, d: 4, get e() { log.push(target ? Object.keys(target).join("+") : "none"); return 5; } }),
  "deletes what follows": () => { const made: any = { a: 1, get b() { delete made.c; return 2; }, c: 3, d: 4 }; return made; },
  "deletes itself": () => { const made: any = { a: 1, get b() { delete made.b; return 2; }, c: 3 }; return made; },
  "deletes what came before": () => { const made: any = { a: 1, get b() { delete made.a; return 2; }, c: 3 }; return made; },
  adds: () => { const made: any = { a: 1, get b() { made.late = 5; return 2; }, c: 3 }; return made; },
  "hides what follows": () => { const made: any = { a: 1, get b() { Object.defineProperty(made, "c", { enumerable: false }); return 2; }, c: 3, d: 4 }; return made; },
  "changes what follows": () => { const made: any = { a: 1, get b() { made.c = "changed"; made.d = 0.5; return 2; }, c: 3, d: 4 }; return made; },
  "puts a getter behind itself": () => { const made: any = { a: 1, get b() { Object.defineProperty(made, "c", { get() { log.push("new c"); return "got"; }, enumerable: true }); return 2; }, c: 3, d: 4 }; return made; },
  "makes what follows a value": () => { const made: any = { a: 1, get b() { Object.defineProperty(made, "c", { value: "plain", enumerable: true }); return 2; }, get c() { log.push("old c"); return 3; }, d: 4 }; return made; },
  "deletes and adds again": () => { const made: any = { a: 1, get b() { delete made.c; made.c = "again"; return 2; }, c: 3, d: 4 }; return made; },
  "freezes the source": () => { const made: any = { a: 1, get b() { Object.freeze(made); return 2; }, c: 3 }; return made; },
  "loses names and collects": () => {
    const made: any = { a: 1 };
    for (let i = 0; i < 6; i++) made["name" + i + Math.floor(log.length)] = i;
    Object.defineProperty(made, "b", { get() { for (const key of Object.keys(made)) if (key.startsWith("name")) delete made[key]; Bun.gc(true); return 2; }, enumerable: true, configurable: true });
    made.tail = 9;
    const order = Object.keys(made);
    // The getter stands in front of the names it deletes.
    const again: any = {};
    Object.defineProperty(again, "b", Object.getOwnPropertyDescriptor(made, "b")!);
    for (const key of order) if (key !== "b") again[key] = made[key];
    Object.defineProperty(again, "b", { get() { for (const key of Object.keys(again)) if (key.startsWith("name")) delete again[key]; Bun.gc(true); return 2; }, enumerable: true, configurable: true });
    return again;
  },
  "puts a setter on the target": () => ({ a: 1, get b() { if (target) Object.defineProperty(target, "c", { set(value) { log.push("target.c=" + value); }, configurable: true, enumerable: true }); return 2; }, c: 3, d: 4 }),
  "makes a name of the target read-only": () => ({ a: 1, get b() { if (target) Object.defineProperty(target, "c", { value: "kept", writable: false, configurable: true, enumerable: true }); return 2; }, c: 3, d: 4 }),
  "freezes the target": () => ({ a: 1, get b() { if (target) Object.freeze(target); return 2; }, c: 3 }),
  "closes the target": () => ({ a: 1, get b() { if (target) Object.preventExtensions(target); return 2; }, c: 3 }),
  "puts a setter above the target": () => ({ a: 1, get b() { if (target) Object.setPrototypeOf(target, { set c(value: number) { log.push("above.c=" + value); } }); return 2; }, c: 3, d: 4 }),
  "a setter of the target changes the source": () => {
    const made: any = { a: 1, get b() { if (target) Object.defineProperty(target, "c", { set(value) { log.push("target.c=" + value); made.d = "changed"; delete made.e; }, configurable: true }); return 2; }, c: 3, d: 4, e: 5, f: 6 };
    return made;
  },
  "stores to the target": () => ({ a: 1, get b() { if (target) { target.a = "overwritten"; target.early = 0; } return 2; }, c: 3 }),
};
const targets: Record<string, () => any> = {
  empty: () => ({}),
  labelled: () => ({ label: 0 }),
  "has the names": () => ({ a: "a", b: "b", c: "c", d: "d" }),
  parsed: () => JSON.parse('{"label":0}'),
  instance: () => new Holder(),
  list: () => [],
  "has a setter": () => ({ set a(value: number) { log.push("target.a=" + value); } }),
  "has a read-only name": () => Object.defineProperty({}, "c", { value: "kept", enumerable: true }),
  frozen: () => Object.freeze({ a: 0 }),
  "below a setter": () => Object.create({ set d(value: number) { log.push("above.d=" + value); } }),
};
function show(name: string, run: () => any) {
  let line = "";
  for (let turn = 0; turn < 5; turn++) {
    log.length = 0;
    target = null;
    let made: any;
    try {
      made = run();
      line = digest(made);
    } catch (error) {
      line = (error as Error).name + (target ? " " + digest(target) : "");
    }
    if (log.length) line += " | " + log.join();
  }
  console.log(name + ": " + line);
}
for (const [sourceName, source] of Object.entries(sources)) {
  for (const [targetName, make] of Object.entries(targets))
    show("assign " + sourceName + " to " + targetName, () => { target = make(); return Object.assign(target, source()); });
  show("assign " + sourceName + " to a literal", () => Object.assign({}, source()));
  show("assign " + sourceName + " to a literal with a member", () => Object.assign({ label: 0 }, source()));
  show("assign " + sourceName + " twice", () => Object.assign({}, source(), source()));
  show("assign a literal and " + sourceName, () => { target = {}; return Object.assign(target, { a: "first", z: 0 }, source()); });
  show("spread " + sourceName, () => ({ ...source() }));
  show("spread " + sourceName + " behind a member", () => ({ label: 0, b: "before", ...source() }));
  show("spread " + sourceName + " in front of a member", () => ({ ...source(), b: "after" }));
  show("spread " + sourceName + " twice", () => ({ ...source(), ...source() }));
  show("rest of " + sourceName, () => { const { a, ...rest } = source(); return rest; });
  show("rest of " + sourceName + " without the getter", () => { const { b, ...rest } = source(); return rest; });
  show("rest of " + sourceName + " under a key", () => { const key = log.length ? "a" : "c"; const { [key]: taken, ...rest } = source(); return rest; });
}
