// STATISTIC: EnumeratorChecksReusingStepResult >= 1
// Under: --aot-check=Validate: the operand that the test is handed is the step's own result
// Under: --aot-harden=proof-checks: what the test has proven of the enumerator is asked of memory
// Under: --aot-testing=FailSpeculations: the test fails once and the read goes as it is written
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the read under the enumerator's index is held against the read by name
// Under: --aot-testing=CheckEffectsAtRunTime: what stands between the step and the read writes no more than it declares
'use strict';
const make = () => JSON.parse('{"ash":1,"birch":2,"cedar":3,"date":4,"elm":5,"fir":6,"gum":7,"hazel":8,"ivy":9}');
const tell = (value) => (value === undefined ? "_" : typeof value === "object" ? JSON.stringify(value) : String(value));
function straight(o) { let text = ""; for (const k in o) text += k + "=" + tell(o[k]) + ","; return text; }
function twice(o) { let text = ""; for (const k in o) text += tell(o[k]) + tell(o[k]) + ","; return text; }
function deletesNext(o, victim) { let text = ""; for (const k in o) { if (k === "cedar") delete o[victim]; text += k + "=" + tell(o[k]) + ","; } return text; }
function deletesItself(o) { let text = ""; for (const k in o) { if (k === "date") delete o[k]; text += k + "=" + tell(o[k]) + ","; } return text; }
function adds(o) { let text = ""; for (const k in o) { if (k === "birch") o.added = 100; text += k + "=" + tell(o[k]) + ","; } return text + tell(o.added); }
function addsMany(o) { let text = "", n = 0; for (const k in o) { o["more" + n++] = n; text += k + "=" + tell(o[k]) + ","; } return text; }
function calls(o, between) { let text = ""; for (const k in o) { between(o, k); text += k + "=" + tell(o[k]) + ","; } return text; }
function redefines(o) { let text = ""; for (const k in o) { if (k === "elm") Object.defineProperty(o, "fir", { get() { return "got"; }, enumerable: true, configurable: true }); text += k + "=" + tell(o[k]) + ","; } return text; }
function storesUnderKey(o) { let text = ""; for (const k in o) { o[k] = o[k] * 2; text += k + "=" + tell(o[k]) + ","; } return text; }
function readsAnother(o, other) { let text = ""; for (const k in o) text += tell(other[k]) + tell(o[k]) + ","; return text; }
function readsByName(o) { let text = ""; for (const k in o) { const seen = o.trap; text += tell(seen) + k + "=" + tell(o[k]) + ","; } return text; }
function swaps(o, other) { let text = "", held = o; for (const k in o) { text += k + "=" + tell(held[k]) + ","; held = held === o ? other : o; } return text; }
const rounds = +process.argv[2] || 3;
let all = "";
for (let t = 0; t < rounds; t++) {
  all = "";
  const line = (text) => { all += text + "\n"; };
  line(straight(make())); line(twice(make()));
  for (const victim of ["date", "ivy", "ash", "cedar", "none"]) line(deletesNext(make(), victim));
  line(deletesItself(make())); line(adds(make())); line(addsMany(make())); line(redefines(make())); line(storesUnderKey(make()));
  line(calls(make(), () => {})); line(calls(make(), (o, k) => { if (k === "birch") delete o.cedar; })); line(calls(make(), (o, k) => { if (k === "birch") delete o.birch; }));
  line(calls(make(), (o, k) => { if (k === "gum") { delete o.hazel; o.hazel = "again"; } })); line(calls(make(), (o, k) => { if (k === "ash") Object.setPrototypeOf(o, { above: 1 }); }));
  line(calls(make(), (o, k) => { if (k === "cedar") for (let i = 0; i < 80; i++) o["wide" + i] = i; })); line(calls(make(), (o, k) => { if (k === "cedar") Object.freeze(o); }));
  line(readsAnother(make(), make())); line(readsAnother(make(), { ash: "a", elm: "e" })); line(readsAnother(make(), [])); line(swaps(make(), { ash: "A", birch: "B", cedar: "C", date: "D", elm: "E" }));
  const trapped = make(); Object.defineProperty(trapped, "trap", { get() { delete this.gum; return "t"; }, enumerable: false, configurable: true }); line(readsByName(trapped));
  const written = { ash: 1, birch: 2.5, cedar: "three", date: null, elm: undefined, fir: [6], gum: { g: 7 } }; line(straight(written)); line(deletesNext({ ...written }, "date")); line(calls({ ...written }, (o, k) => { if (k === "birch") delete o.cedar; }));
  class Tree { constructor() { this.ash = 1; this.birch = 2; this.cedar = 3; } get leaf() { return "leaf"; } } line(straight(new Tree())); line(deletesNext(new Tree(), "ash")); line(adds(new Tree()));
  line(straight(Object.create({ above: 1, ash: "shadowed" }, { ash: { value: 1, enumerable: true }, hidden: { value: 2, enumerable: false } }))); line(straight(Object.assign(Object.create(null), make())));
  line(straight([10, 20, , 40])); line(straight(Object.assign([1, 2], { named: 3 }))); line(straight("text")); line(straight(new Proxy(make(), {}))); line(straight(new Proxy(make(), { get: (o, k) => "p" + String(k) })));
  line(straight(null)); line(straight(undefined)); line(straight(7)); line(straight(new Uint8Array([5, 6]))); line(straight(function named() {})); line(straight(new Map([[1, 2]])));
}
console.log(all);
