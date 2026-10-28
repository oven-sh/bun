// The parent of a class is whatever the class's own [[Prototype]] is at the moment `super(..)` runs, and Reflect.construct lets any function make the instance of any class. So an instance of
// `class Child extends Base` need not have gone through Base: the fields that Base stores are missing, others stand in their place. What the compiler believes of the instances of a class may not
// decide what is read from such an object. A program is what Base stores, the class below it, the new maker, how the maker gets there, when, and whether the object is made and read at the
// module's top (nothing but the class decides what is believed of it) or in functions that see other objects too. Every program reads the field in nine ways.
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const fields: Record<string, string | null> = { // what the old parent stores
    number: "this.v = n;", fraction: "this.v = n + 0.5;", text: 'this.v = "t" + n;', record: "this.v = { n };", list: "this.v = [n];", three: 'this.u = n; this.v = "t" + n; this.w = { n };', declared: null,
  };
  const children: Record<string, string> = { // the class below
    empty: "class Child extends Base {}",
    ownConstructor: "class Child extends Base { constructor(n) { super(n); this.own = n * 2; } }",
    ownField: "class Child extends Base { own = 7; }",
    readsInConstructor: "class Child extends Base { constructor(n) { super(n); this.seen = typeof this.v; } }",
    fieldReadsTheParents: "class Child extends Base { seen = typeof this.v; }",
    twoBelow: "class Middle extends Base {}\nclass Child extends Middle {}",
  };
  const parents: Record<string, string> = { // the new maker
    emptyFunction: "function () {}",
    storesOther: "function (n) { this.other = n; }",
    storesSameAsText: 'function (n) { this.v = "replaced"; }',
    otherClass: "class Other { constructor(n) { this.other = n; } }",
    answersObject: "function () { return { answered: true }; }",
    objectItself: "Object",
    arrayItself: "Array",
    bound: "function () {}.bind(null)",
    proxy: "new Proxy(function () {}, {})",
  };
  const ways: Record<string, { change: (X: string, P: string) => string; make?: (n: number | string) => string }> = { // how the maker gets there; X = whose [[Prototype]] is changed, P = the new maker; `make` where the instance is not made by `new Child(n)`
    setPrototypeOf: { change: (X, P) => `Object.setPrototypeOf(${X}, ${P});` },
    reflect: { change: (X, P) => `Reflect.setPrototypeOf(${X}, ${P});` },
    proto: { change: (X, P) => `${X}.__proto__ = ${P};` },
    throughHelper: { change: (X, P) => `function change(a, b) { Object.setPrototypeOf(a, b); }\nchange(${X}, ${P});` },
    throughList: { change: (X, P) => `for (const k of [${X}]) Object.setPrototypeOf(k, ${P});` },
    throughAlias: { change: (X, P) => `const alias = ${X};\nObject.setPrototypeOf(alias, ${P});` },
    outOfAMap: { change: (X, P) => `const makers = new Map([["maker", ${P}]]);\nObject.setPrototypeOf(${X}, makers.get("maker"));` },
    outOfACallback: { change: (X, P) => `function pick(choose) { return choose(); }\nObject.setPrototypeOf(${X}, pick(() => ${P}));` },
    reflectConstruct: { change: (X, P) => `const maker = ${P};`, make: (n: number | string) => `Reflect.construct(maker, [${n}], Child)` },
  };
  const whens = ["before", "between", "backAgain"]; // before any instance is made | between two instances | changed, an instance, changed back, an instance
  const readers: Record<string, string> = {
    inPlace: "show(o.v)",
    arithmetic: "show(o.v + 1)",
    template: "`${String(o.v)}`",
    inFunction: "read(o)",
    method: "o.get()",
    keys: "Object.keys(o).join()",
    deep: "show(o.v?.n ?? o.v?.length ?? o.v?.[0])",
    pattern: "(({ v }) => show(v))(o)",
    methodInALoop: "[o, o, o].map(each => each.get()).join()",
  };
  const head = `function show(v) { return typeof v + ":" + (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)); }
function read(x) { return show(x.v); }
`;
  for (const [f, field] of Object.entries(fields)) for (const [c, child] of Object.entries(children)) for (const [p, parent] of Object.entries(parents)) for (const [w, way] of Object.entries(ways)) for (const when of whens) {
    if (w !== "setPrototypeOf" && w !== "reflectConstruct" && (f !== "text" && f !== "fraction" || c !== "empty" && c !== "twoBelow")) continue; // every way for two kinds of field and two children; two ways for all
    if (when === "backAgain" && (way.make || f !== "text" && f !== "fraction" && f !== "record")) continue;
    const base = field === null ? 'class Base { v = "declared"; get() { return show(this.v); } }' : `class Base { constructor(n) { ${field} } get() { return show(this.v); } }`;
    const who = c === "twoBelow" ? "Middle" : "Child", make = way.make ?? ((n: number | string) => `new Child(${n})`);
    const back = when === "backAgain" ? `Object.setPrototypeOf(${who}, Base);\n` : "";
    // two forms: `direct`: the object is made and read at the module's top, so that nothing but the class decides what is believed of it; `through`: made and read in functions that see other objects too
    const usesOf = (label: string, o: string) => Object.entries(readers).map(([r, text]) => `try { console.log("${label}", "${r}", ${text.replace(/\bo\b/g, o)}); } catch (e) { console.log("${label}", "${r}", "threw", e.name); }`).join("\n");
    const direct = `${when === "between" ? "const first = new Child(1);\n" + usesOf("first", "first") + "\n" : ""}${way.change(who, parent)}\nconst changed = ${make(2)};\n${usesOf("changed", "changed")}\nconsole.log(changed instanceof Child, changed instanceof Base);\n${back ? back + "const again = new Child(4);\n" + usesOf("again", "again") + "\n" : ""}const base = new Base(3);\n${usesOf("base", "base")}\n`;
    const uses = Object.entries(readers).map(([r, text]) => `  try { console.log(label, "${r}", ${text}); } catch (e) { console.log(label, "${r}", "threw", e.name); }`).join("\n");
    const through = `function look(label, o) {\n${uses}\n  console.log(label, o instanceof Child, o instanceof Base);\n}\nfunction plain(n) { try { return new Child(n); } catch (e) { return { threw: e.name }; } }\nfunction make(n) { try { return ${make("n")}; } catch (e) { return { threw: e.name }; } }\n${when === "between" ? 'look("first", plain(1));\n' : ""}${way.change(who, parent)}\nlook("changed", make(2));\n${back ? back + 'look("again", plain(4));\n' : ""}look("base", new Base(3));\n`;
    for (const [form, text] of [["direct", direct], ["through", through]]) made.push({ name: `${f}-${c}-${p}-${w}-${when}-${form}`, file: "program.mjs", text: head + `${base}\n${child}\n` + text });
  }
  return made;
}
