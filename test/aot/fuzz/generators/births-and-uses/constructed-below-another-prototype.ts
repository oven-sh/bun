// Who makes the object, what stands above it under the name that the constructor stores, how the object is made, and what is stored. A setter, a read-only member or a proxy above
// takes the store, and then the object is not what `new A()` makes: what the compiler believes of A's objects may not decide what is read from it.
export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const values: Record<string, string> = { number: "1", double: "1.5", string: '"text"', object: "{ a: 1 }", array: "[1, 2]", func: "function () { return 7; }" };
  // the maker A: stores v (and w behind it)
  const makers: Record<string, (value: string) => string> = {
    func: v => `function A() { this.v = ${v}; this.w = 2; }`,
    funcTwice: v => `function A() { this.v = 0; this.v = ${v}; this.w = 2; }`,
    funcDefine: v => `function A() { Object.defineProperty(this, "v", { value: ${v}, writable: true, enumerable: true, configurable: true }); this.w = 2; }`,
    klass: v => `class A { constructor() { this.v = ${v}; this.w = 2; } }`,
    klassField: v => `class A { v = ${v}; w = 2; }`,
    funcHelper: v => `function fill(o) { o.v = ${v}; o.w = 2; } function A() { fill(this); }`,
  };
  // what stands above, under the name v, on B's prototype
  const aboves: Record<string, string> = {
    nothing: "",
    setter: "set v(x) {}",
    setterKeeps: "set v(x) { this.kept = x; } get v() { return this.kept; }",
    getterOnly: 'get v() { return "got"; }',
    method: 'v() { return "method"; }',
  };
  const laterAboves: Record<string, string> = { // put there behind the class's text
    readOnly: 'Object.defineProperty(B.prototype, "v", { value: "fixed", writable: false, configurable: true });',
    frozenPrototype: "Object.freeze(B.prototype);",
    proxyAbove: "Object.setPrototypeOf(B.prototype, new Proxy(A.prototype, { set(t, k, x, r) { return k === 'v' ? true : Reflect.set(t, k, x, r); } }));",
    setterLate: 'Object.defineProperty(B.prototype, "v", { set(x) {}, configurable: true });',
    setterOnA: 'Object.defineProperty(A.prototype, "v", { set(x) {}, configurable: true });',
    setterOnObject: "",
  };
  const ways: Record<string, string> = {
    newB: "new B()",
    reflect: "Reflect.construct(A, [], B)",
    reflectCall: "Reflect.construct.call(null, A, [], B)",
    reflectApply: "Reflect.apply(Reflect.construct, null, [A, [], B])",
    reflectB: "Reflect.construct(B, [])",
    reflectBA: "Reflect.construct(B, [], A)",
    boundNew: "new (B.bind(null))()",
    reflectBound: "Reflect.construct(A.bind(null), [], B)",
    callOnCreated: "(() => { const o = Object.create(B.prototype); try { A.call(o); } catch (e) { o.threw = e.name; } return o; })()",
    applyOnCreated: "(() => { const o = Object.create(B.prototype); try { A.apply(o, []); } catch (e) { o.threw = e.name; } return o; })()",
    setPrototypeBehind: "Object.setPrototypeOf(new A(), B.prototype)",
  };
  const head = `function text(x) { return typeof x === "function" ? "function" : typeof x === "object" && x !== null ? JSON.stringify(x) : String(x); }
  function far(o) { return [typeof o.v, text(o.v), "v" in o, Object.keys(o).join(), text(o.w)].join(" | "); }
  `;
  for (const strict of [true, false]) for (const [m, maker] of Object.entries(makers)) for (const [val, v] of Object.entries(values)) for (const [a, above] of Object.entries({ ...aboves, ...laterAboves })) for (const [w, way] of Object.entries(ways)) {
    if (!strict && !(a === "readOnly" || a === "frozenPrototype" || a === "getterOnly")) continue; // sloppy code matters where a store is dropped silently
    if (val !== "object" && val !== "number" && (m !== "func" || w.startsWith("bound"))) continue; // every kind of value for the plain maker, two kinds for the rest
    const inClass = a in aboves ? above : "", later = a in laterAboves ? laterAboves[a] : "";
    const body = `${maker(v)}\nclass B extends A { ${inClass} }\n${later}\nfunction run() {\n  let o; try { o = ${way}; } catch (e) { return "threw " + e.name; }\n  const near = [typeof o.v, text(o.v), "v" in o, Object.keys(o).join(), text(o.w)].join(" | ");\n  return near + " || " + far(o);\n}\nconsole.log(run());\n`;
    made.push({ name: `${strict ? "strict" : "sloppy"}-${m}-${val}-${a}-${w}`, file: strict ? "program.mjs" : "program.cjs", text: head + body });
  }
  return made;
}
