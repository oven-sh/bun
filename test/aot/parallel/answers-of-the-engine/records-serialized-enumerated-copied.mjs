// The program makes every record itself, so the analysis knows the layouts, the order of their keys and every store: they are written as JSON, walked and copied by code made for them.
// Among them are records built up by stores, in two orders, with accessors, hidden members, functions and members that are removed. At the end the shell runs the same text itself: every answer is the same.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
function written(value) { return JSON.stringify(value); }
report(written({ a: 1, b: "two" }));
report(written({ b: "two", a: 1 }));
report(written({ a: undefined, b: null }));
report(written({ a: 1.5, b: [1, "x", null] }));
function builtUp(n) { const made = {}; made.first = n; if (n > 1) made.second = "s"; made.third = [n]; return JSON.stringify(made); }
report(builtUp(1));
report(builtUp(2));
function otherOrder(flip) { const made = {}; if (flip) { made.b = 1; made.a = 2; } else { made.a = 2; made.b = 1; } return JSON.stringify(made); }
report(otherOrder(true));
report(otherOrder(false));
function storedThenWritten(meta) { meta.sign = "again"; return JSON.stringify(meta); }
report(storedThenWritten({ sign: "own" }));
report(storedThenWritten(Object.defineProperty({}, "sign", { get() { return "one"; }, set(value) { }, enumerable: true })));
function getterInLiteral(n) { const made = { first: n, get mid() { return "got " + this.first; } }; made.later = n; return JSON.stringify(made); }
report(getterInLiteral(1));
report(getterInLiteral(2));
function hidden(n) { const made = { first: n }; Object.defineProperty(made, "mid", { value: "hidden", enumerable: false }); made.later = n; return JSON.stringify(made); }
report(hidden(1));
function removed(n) { const made = { first: n, second: n, third: n }; delete made.second; made.second = "back"; return JSON.stringify(made); }
report(removed(1));
function withFunction(n) { const made = { first: n, run() { return 1; } }; made.later = () => 2; made.last = n; return JSON.stringify(made); }
report(withFunction(1));
function told(n) { const made = { first: n, toJSON() { return { told: this.first }; } }; return JSON.stringify({ inner: made, list: [made] }); }
report(told(1));
function nested(n) { const made = { inner: { value: n } }; made.inner.more = { deep: [n, { n }] }; return JSON.stringify(made); }
report(nested(1));
function narrowed(meta) { if (typeof meta.sign === "string") meta.sign = [meta.sign]; return JSON.stringify(meta); }
report(narrowed({ sign: ["own"] }));
report(narrowed({ sign: "one" }));
report(narrowed({ get sign() { return "got"; }, set sign(value) { } }));
function keysOf(value) { let text = ""; for (const key in value) text += key + "=" + value[key] + ","; return text; }
report(keysOf({ a: 1, b: 2 }));
report(keysOf({ b: 2, a: 1 }));
report(keysOf({ 1: "x", a: 1, 0: "y" }));
function spreadOver(value) { const copy = { ...value, z: 1 }; copy.y = 2; return JSON.stringify(copy); }
report(spreadOver({ a: 1 }));
report(spreadOver({ z: 0, get a() { return "got"; } }));
report(spreadOver(null));
function kept(value) { const holder = { get: value.get }; return typeof holder.get; }
report(kept(Object.getOwnPropertyDescriptor({ get a() { return 1; } }, "a")));
report(kept(Object.getOwnPropertyDescriptor({ a: 1 }, "a")));
function numberField(n) { const made = { count: 1 }; made.count = n; return made.count + 1; }
report(numberField(2));
report(numberField(2147483647));
report(numberField(1.5));
report(numberField(-0));
function optional(flag) { const made = { a: 1 }; if (flag) made.b = 2; return made.b === undefined ? "none" : made.b; }
report(optional(true));
report(optional(false));
report("end");
