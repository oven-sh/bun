// what is no text is written as a key: undefined, null, true, false; and texts that are keys of elements: "1", "01", "-0", "1.0", "length", "__proto__"
function primitives(o) { return [o[undefined], o[null], o[true], o[false]].join(); }
function numbers(o) { const a = "1", b = "01", c = "-0", d = "1.0", e = "NaN"; return [o[a], o[b], o[c], o[d], o[e], o[-0], o[1]].join(); }
function special(o) { const l = "length", p = "__proto__", c = "constructor"; return [o[l], o[p] === Object.getPrototypeOf(o), o[c] === o.constructor].join(); }
function definesProto(v) { const p = "__proto__"; const made = { [p]: v }; return Object.keys(made).join() + ":" + (Object.getPrototypeOf(made) === Object.prototype); }
const record = { undefined: "u", null: "n", true: "t", false: "f", 1: "one", "01": "zero one", "-0": "minus", "1.0": "point", NaN: "nan", 0: "zero", length: 7 };
const list = ["zero", "one"];
const view = new Uint8Array([7, 8]);
for (let turn = 0; turn < 3; turn++) {
  console.log(primitives(record), numbers(record), special(record));
  console.log(primitives(list), numbers(list), special(list));
  console.log(primitives(view), numbers(view), special(view));
  console.log(numbers("ab"), special("ab"), definesProto({ x: 1 }));
}
