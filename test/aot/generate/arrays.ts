// The programs of arrays that are another program without its types.
import { programsOf, text, untypedTwins } from "../generate";

export const programs = () =>
  programsOf({
    "holes-made-by-every-door.js": text(
      `// Every way to make a hole in an array, and the operations that must not count as one. Each case has its own literal and its own readers: a proof that an array has no holes is about all arrays of a site.
const pick = Date.now() > 0;
function deleteSecond(list) { delete list[1]; }
function lengthen(list) { list.length = list.length + 2; }
function same(list) { return list; }
const lines = [];
function run(name, f) { try { lines.push(name + ": " + f()); } catch (error) { lines.push(name + ": threw " + error.name); } }`,
      [
        `= a.length + 1	one", f1	++	increment", f2
+= 2	two", f3	 = "6"	from text", f4`,
        (n, a, b, c, d) => `function f${2 * n + 1}() {
  const a = [1, 2, 3, 4];
  a.length ${a};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | length plus ${b});
function f${2 * n + 2}() {
  const a = [1, 2, 3, 4];
  a.length${c};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | length ${d});`,
      ],
      [
        `{ valueOf() { return 6; } }	length from object", f5
0; a[1] = 7	emptied, stored at one", f6
0; a.push(7); a.push(7)	emptied, pushed", f7
1; a.length = 3	shorter, longer", f8`,
        (n, a, b) => `function f${n + 5}() {
  const a = [1, 2, 3, 4];
  a.length = ${a};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | ${b});`,
      ],
      `function f9() {
  const a = [1, 2, 3, 4];
  delete a[0];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | delete first", f9);
function f10() {
  const a = [1, 2, 3, 4];
  delete a[a.length - 1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | delete last", f10);
function f11() {
  const a = [1, 2, 3, 4];
  for (let k = 0; k < a.length; k += 2) delete a[k];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | delete by variable", f11);
function f12() {
  const a = [1, 2, 3, 4];
  a[a.length + 1] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | store above length", f12);
function f13() {
  const a = [1, 2, 3, 4];
  a[a.length] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | store at length", f13);
function f14() {
  const a = [1, 2, 3, 4];
  a[40] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | store far", f14);
function f15() {
  const a = [1, 2, 3, 4];
  a[200000] = 7; a.length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | store very far", f15);
function f16() {
  const a = [1, 2, 3, 4];
  a[1] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | store inside", f16);
function f17() {
  const a = [1, 2, 3, 4];
  a["6"] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | store under text", f17);
function f18() {
  const a = [1, 2, 3, 4];
  Object.defineProperty(a, 6, { value: 7, writable: true, enumerable: true, configurable: true });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | define above length", f18);
function f19() {
  const a = [1, 2, 3, 4];
  Object.defineProperty(a, "length", { value: 6 });`,
      [
        `define length", f19	set(a, 6, 7
reflect set", f20	set(a, "length", 6
reflect set length", f21	deleteProperty(a, 1`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | ${a});
function f${n + 20}() {
  const a = [1, 2, 3, 4];
  Reflect.${b});`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | reflect delete", f22);
function f23() {
  const a = [1, 2, 3, 4];
  Object.assign(a, { 6: 7 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | assign", f23);
function f24() {
  const a = [1, 2, 3, 4];
  [a[6]] = [7];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | pattern target", f24);
function f25() {
  const a = [1, 2, 3, 4];
  [a[0], a[1]] = [a[1], a[0]];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | swap", f25);
function f26() {
  const a = [1, 2, 3, 4];
  const b = a; delete b[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | alias", f26);
function f27() {
  const a = [1, 2, 3, 4];
  const o = { list: a }; delete o.list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | alias in object", f27);
function f28() {
  const a = [1, 2, 3, 4];
  const f = () => { delete a[1]; }; f();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | alias in closure", f28);
function f29() {
  const a = [1, 2, 3, 4];
  deleteSecond(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | callee deletes", f29);
function f30() {
  const a = [1, 2, 3, 4];
  lengthen(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | callee lengthens", f30);
function f31() {
  const a = [1, 2, 3, 4];
  (function () { delete arguments[0][1]; })(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | through arguments", f31);
function f32() {
  const a = [1, 2, 3, 4];
  const p = new Proxy(a, {}); delete p[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | through proxy", f32);
function f33() {
  const a = [1, 2, 3, 4];
  const p = new Proxy(a, {}); p.length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | through proxy length", f33);
function f34() {
  const a = [1, 2, 3, 4];
  Array.prototype.pop.call(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | pop call", f34);
function f35() {
  const a = [1, 2, 3, 4];
  a.push(7); a.pop(); a.shift(); a.unshift(7, 7);`,
      [
        `push, pop, shift, unshift", f35	, 2
splice out", f36	, 0, 7, 7
splice in", f37	0, 0, 7
splice beyond", f38	, 0, ...[1, , 3, 4]`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | ${a});
function f${n + 36}() {
  const a = [1, 2, 3, 4];
  a.splice(1${b});`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | splice in holes", f39);
function f40() {
  const a = [1, 2, 3, 4];
  a.reverse();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | reverse", f40);
function f41() {
  const a = [1, 2, 3, 4];
  a.fill(7, 1, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | fill", f41);
function f42() {
  const a = [1, 2, 3, 4];
  a.fill(7, 2, 10);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | fill beyond", f42);
function f43() {
  const a = [1, 2, 3, 4];
  a.copyWithin(0, 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | copyWithin", f43);
function f44() {
  const a = [1, 2, 3, 4];
  a.sort();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | sort", f44);
function f45() {
  const a = [1, 2, 3, 4];
  a.sort((x, y) => { delete a[0]; return x < y ? -1 : x > y ? 1 : 0; });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | sort that deletes", f45);
function f46() {
  const a = [1, 2, 3, 4];
  a.push(...[1, , 3, 4]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | push spread holes", f46);
function f47() {
  const a = [1, 2, 3, 4];
  const p = new Proxy(a, {}); p[6] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | through proxy store", f47);
function f48() {
  const a = [1, 2, 3, 4];
  Reflect.set(new Proxy(a, {}), 6, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | through proxy reflect", f48);
function f49() {
  const a = [1, 2, 3, 4];
  Reflect.set({}, 6, 7, a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | reflect set with receiver", f49);
function f50() {
  const a = [1, 2, 3, 4];
  const heir = Object.create(a); Reflect.set(heir, 6, 7, a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | reflect set on heir", f50);
function f51() {
  const a = [1, 2, 3, 4];
  for (a[6] of [7]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | loop target", f51);
function f52() {
  const a = [1, 2, 3, 4];
  for (a[6] in { p: 1 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | loop target in", f52);
function f53() {
  const a = [1, 2, 3, 4];
  Object.defineProperties(a, { 6: { value: 7, writable: true, enumerable: true, configurable: true } });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | define properties", f53);
function f54() {
  const a = [1, 2, 3, 4];
  const k = "" + (a.length + 2); a[k] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | computed text key", f54);
function f55() {
  const a = [1, 2, 3, 4];
  const k = { toString() { return "6"; } }; a[k] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | key from object", f55);
function f56() {
  const a = [1, 2, 3, 4];
  a[6]++;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | increment above", f56);
function f57() {
  const a = [1, 2, 3, 4];
  a[6] ||= 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | assign or above", f57);
function f58() {
  const a = [1, 2, 3, 4];
  const rows = [a]; delete rows[0][1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | in a holder array", f58);
function f59() {
  const a = [1, 2, 3, 4];
  for (const list of new Set([a])) delete list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | in a set", f59);
function f60() {
  const a = [1, 2, 3, 4];
  same(a).length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | returned by callee", f60);
function f61() {
  const a = [1, 2, 3, 4];
  (function () { delete this[1]; }).call(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | bound this", f61);
function f62() {
  const a = [1, 2, 3, 4];
  const o = { get list() { return a; } }; delete o.list[1];`,
      [
        `with a getter", f62	pick ? [1, 2, 3, 4] : Array(3)	literal or Array(n)", f63	pick ? [1, 2, 3, 4] : new Array(3)
literal or new Array(n)", f64	!pick ? [1, 2, 3, 4] : new Array(3)	Array(n) or literal", f65	new Array(7, 7, 7)
new Array of items", f66	Array.of(7, 7)	Array.of", f67	[1, 2, 3, 4].concat([1, , 3, 4])
concat holes", f68	[1, , 3, 4].concat([1, 2, 3, 4])	holes concat", f69	[1, 2, 3, 4].concat([1, 2, 3, 4], 7)
concat whole", f70	[1, 2, 3, 4].concat({ length: 3, 0: 7, [Symbol.isConcatSpreadable]: true })	concat array-like", f71	[...[1, , 3, 4]]
spread holes", f72	[...[1, 2, 3, 4], 7]	spread whole", f73	Array.from({ length: 3 })
from length", f74	Array.from([1, , 3, 4])	from holes", f75	[1, , 3, 4].slice(0, 3)
slice holes", f76	[1, 2, 3, 4].slice(1)	slice whole", f77	[1, , 3, 4].splice(0, 3)
splice result holes", f78	[1, 2, 3, 4].splice(0, 3)	splice result whole", f79	[1, , 3, 4].fill(7)
holes filled", f80	[1, , 3, 4].fill(7, 2)	holes part filled", f81	[1, , 3, 4].copyWithin(2, 0)
holes copyWithin", f82	[1, , 3, 4].sort()	holes sorted", f83	[1, , 3, 4].reverse()
holes reversed", f84	[1, , 3, 4].toReversed()	holes toReversed", f85	[1, , 3, 4].toSorted()
holes toSorted", f86	[1, , 3, 4].toSpliced(0, 1)	holes toSpliced", f87	[1, , 3, 4].with(0, 7)
holes with", f88	[1, , 3, 4].flat()	holes flat", f89	Object.keys({ p: 1, q: 2, r: 3 }); delete a[1]
keys then delete", f90	Object.keys({ p: 1, q: 2, r: 3 })	keys", f91	Object.values({ p: 7, q: 7 })
values", f92	"p,q,,r".split(",")	split", f93	"p,q".split(","); a.length = 4
split then longer", f94	JSON.parse("[1, 2, 3]")	parsed", f95	JSON.parse("[1, 2, 3]", (k, v) => (v === 2 ? undefined : v))
parsed and revived", f96	((...rest) => rest)(7, 7, 7)	rest", f97	((...rest) => rest)(7, 7, 7); delete a[1]
rest then delete", f98	new Array(...[3])	new Array of spread length", f99	Array(...[3])
Array of spread length", f100	Array.apply(null, [3])	Array applied", f101	Reflect.construct(Array, [3])
Array constructed", f102	new Array(pick ? 3 : 7)	new Array of number or item", f103	new Array(pick ? 7 : 3)`,
        (n, a, b, c, d) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | ${a});
function f${2 * n + 63}() {
  const a = ${b};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | ${c});
function f${2 * n + 64}() {
  const a = ${d};`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | new Array of item or number", f104);
function f105() {
  class Rows extends Array {} const a = new Rows(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | subclass of length", f105);
function f106() {
  class Rows extends Array {} const a = new Rows(7, 7);`,
      [
        `subclass of items", f106	[7, 7, , ]
literal with elision at end", f107	[...[1, 2, 3, 4], , 7]
spread then elision", f108	[1, , 3, 4].slice(0).slice(0)
slice of slice of holes", f109	[1, 2, 3, 4].concat([1, 2, 3, 4].concat([1, , 3, 4]))
concat of concat of holes", f110	(pick ? [1, , 3, 4] : [1, 2, 3, 4]).slice(0)
slice of either", f111	Object.entries({ p: 7, q: 7 })[1]
entries", f112	Reflect.ownKeys({ p: 1, q: 2 })
own keys", f113	Object.getOwnPropertyNames({ p: 1, q: 2 })
names", f114	"p1q22r".split(/\\d/)
split by pattern", f115	"p1q".split(/(\\d)|(x)/)
split with groups", f116	"p1q".match(/(\\d)|(x)/)
match", f117	[1, 2, 3, 4].with(0, 7); delete a[2]
with then delete", f118	[1, 2, 3, 4].toSpliced(0, 1); a.length = 5
toSpliced then longer", f119	[1.5, 2.5, 3.5, 4.5]`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | ${a});
function f${n + 107}() {
  const a = ${b};`,
      ],
      [
        `= a.length + 1	one", f120	++	increment", f121
+= 2	two", f122	 = "6"	from text", f123`,
        (n, a, b, c, d) => `  a.length ${a};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | length plus ${b});
function f${2 * n + 121}() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length${c};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | length ${d});
function f${2 * n + 122}() {
  const a = [1.5, 2.5, 3.5, 4.5];`,
      ],
      [
        `{ valueOf() { return 6; } }	length from object", f124
0; a[1] = 7.5	emptied, stored at one", f125
0; a.push(7.5); a.push(7.5)	emptied, pushed", f126
1; a.length = 3	shorter, longer", f127`,
        (n, a, b) => `  a.length = ${a};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | ${b});
function f${n + 125}() {
  const a = [1.5, 2.5, 3.5, 4.5];`,
      ],
      `  delete a[0];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | delete first", f128);
function f129() {
  const a = [1.5, 2.5, 3.5, 4.5];
  delete a[a.length - 1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | delete last", f129);
function f130() {
  const a = [1.5, 2.5, 3.5, 4.5];
  for (let k = 0; k < a.length; k += 2) delete a[k];`,
      [
        `delete by variable", f130	a.length + 1
store above length", f131	a.length
store at length", f132	40`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | ${a});
function f${n + 131}() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a[${b}] = 7.5;`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | store far", f133);
function f134() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a[200000] = 7.5; a.length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | store very far", f134);
function f135() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a[1] = 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | store inside", f135);
function f136() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a["6"] = 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | store under text", f136);
function f137() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Object.defineProperty(a, 6, { value: 7.5, writable: true, enumerable: true, configurable: true });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | define above length", f137);
function f138() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Object.defineProperty(a, "length", { value: 6 });`,
      [
        `define length", f138	set(a, 6, 7.5
reflect set", f139	set(a, "length", 6
reflect set length", f140	deleteProperty(a, 1`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | ${a});
function f${n + 139}() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Reflect.${b});`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | reflect delete", f141);
function f142() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Object.assign(a, { 6: 7.5 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | assign", f142);
function f143() {
  const a = [1.5, 2.5, 3.5, 4.5];
  [a[6]] = [7.5];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | pattern target", f143);
function f144() {
  const a = [1.5, 2.5, 3.5, 4.5];
  [a[0], a[1]] = [a[1], a[0]];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | swap", f144);
function f145() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const b = a; delete b[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | alias", f145);
function f146() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const o = { list: a }; delete o.list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | alias in object", f146);
function f147() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const f = () => { delete a[1]; }; f();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | alias in closure", f147);
function f148() {
  const a = [1.5, 2.5, 3.5, 4.5];
  deleteSecond(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | callee deletes", f148);
function f149() {
  const a = [1.5, 2.5, 3.5, 4.5];
  lengthen(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | callee lengthens", f149);
function f150() {
  const a = [1.5, 2.5, 3.5, 4.5];
  (function () { delete arguments[0][1]; })(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | through arguments", f150);
function f151() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const p = new Proxy(a, {}); delete p[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | through proxy", f151);
function f152() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const p = new Proxy(a, {}); p.length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | through proxy length", f152);
function f153() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Array.prototype.pop.call(a);`,
      [
        `pop call", f153	push(7.5); a.pop(); a.shift(); a.unshift(	push, pop, shift, unshift", f154	, 2
splice out", f155	splice(1, 0, 	splice in", f156	0, 0, 7.5`,
        (n, a, b, c, d) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | ${a});
function f${2 * n + 154}() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.${b}7.5, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | ${c});
function f${2 * n + 155}() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.splice(1${d});`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | splice beyond", f157);
function f158() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.splice(1, 0, ...[1.5, , 3.5, 4.5]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | splice in holes", f158);
function f159() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.reverse();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | reverse", f159);
function f160() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.fill(7.5, 1, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | fill", f160);
function f161() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.fill(7.5, 2, 10);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | fill beyond", f161);
function f162() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.copyWithin(0, 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | copyWithin", f162);
function f163() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.sort();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | sort", f163);
function f164() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.sort((x, y) => { delete a[0]; return x < y ? -1 : x > y ? 1 : 0; });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | sort that deletes", f164);
function f165() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.push(...[1.5, , 3.5, 4.5]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | push spread holes", f165);
function f166() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const p = new Proxy(a, {}); p[6] = 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | through proxy store", f166);
function f167() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Reflect.set(new Proxy(a, {}), 6, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | through proxy reflect", f167);
function f168() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Reflect.set({}, 6, 7.5, a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | reflect set with receiver", f168);
function f169() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const heir = Object.create(a); Reflect.set(heir, 6, 7.5, a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | reflect set on heir", f169);
function f170() {
  const a = [1.5, 2.5, 3.5, 4.5];
  for (a[6] of [7.5]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | loop target", f170);
function f171() {
  const a = [1.5, 2.5, 3.5, 4.5];
  for (a[6] in { p: 1 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | loop target in", f171);
function f172() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Object.defineProperties(a, { 6: { value: 7.5, writable: true, enumerable: true, configurable: true } });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | define properties", f172);
function f173() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const k = "" + (a.length + 2); a[k] = 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | computed text key", f173);
function f174() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const k = { toString() { return "6"; } }; a[k] = 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | key from object", f174);
function f175() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a[6]++;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | increment above", f175);
function f176() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a[6] ||= 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | assign or above", f176);
function f177() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const rows = [a]; delete rows[0][1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | in a holder array", f177);
function f178() {
  const a = [1.5, 2.5, 3.5, 4.5];
  for (const list of new Set([a])) delete list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | in a set", f178);
function f179() {
  const a = [1.5, 2.5, 3.5, 4.5];
  same(a).length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | returned by callee", f179);
function f180() {
  const a = [1.5, 2.5, 3.5, 4.5];
  (function () { delete this[1]; }).call(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | bound this", f180);
function f181() {
  const a = [1.5, 2.5, 3.5, 4.5];
  const o = { get list() { return a; } }; delete o.list[1];`,
      [
        `with a getter", f181	pick ? [1.5, 2.5, 3.5, 4.5] : Array(3)	literal or Array(n)", f182	pick ? [1.5, 2.5, 3.5, 4.5] : new Array(3)
literal or new Array(n)", f183	!pick ? [1.5, 2.5, 3.5, 4.5] : new Array(3)	Array(n) or literal", f184	new Array(7.5, 7.5, 7.5)
new Array of items", f185	Array.of(7.5, 7.5)	Array.of", f186	[1.5, 2.5, 3.5, 4.5].concat([1.5, , 3.5, 4.5])
concat holes", f187	[1.5, , 3.5, 4.5].concat([1.5, 2.5, 3.5, 4.5])	holes concat", f188	[1.5, 2.5, 3.5, 4.5].concat([1.5, 2.5, 3.5, 4.5], 7.5)
concat whole", f189	[1.5, 2.5, 3.5, 4.5].concat({ length: 3, 0: 7.5, [Symbol.isConcatSpreadable]: true })	concat array-like", f190	[...[1.5, , 3.5, 4.5]]
spread holes", f191	[...[1.5, 2.5, 3.5, 4.5], 7.5]	spread whole", f192	Array.from({ length: 3 })
from length", f193	Array.from([1.5, , 3.5, 4.5])	from holes", f194	[1.5, , 3.5, 4.5].slice(0, 3)
slice holes", f195	[1.5, 2.5, 3.5, 4.5].slice(1)	slice whole", f196	[1.5, , 3.5, 4.5].splice(0, 3)
splice result holes", f197	[1.5, 2.5, 3.5, 4.5].splice(0, 3)	splice result whole", f198	[1.5, , 3.5, 4.5].fill(7.5)
holes filled", f199	[1.5, , 3.5, 4.5].fill(7.5, 2)	holes part filled", f200	[1.5, , 3.5, 4.5].copyWithin(2, 0)
holes copyWithin", f201	[1.5, , 3.5, 4.5].sort()	holes sorted", f202	[1.5, , 3.5, 4.5].reverse()
holes reversed", f203	[1.5, , 3.5, 4.5].toReversed()	holes toReversed", f204	[1.5, , 3.5, 4.5].toSorted()
holes toSorted", f205	[1.5, , 3.5, 4.5].toSpliced(0, 1)	holes toSpliced", f206	[1.5, , 3.5, 4.5].with(0, 7.5)
holes with", f207	[1.5, , 3.5, 4.5].flat()	holes flat", f208	Object.keys({ p: 1, q: 2, r: 3 }); delete a[1]
keys then delete", f209	Object.keys({ p: 1, q: 2, r: 3 })	keys", f210	Object.values({ p: 7.5, q: 7.5 })
values", f211	"p,q,,r".split(",")	split", f212	"p,q".split(","); a.length = 4
split then longer", f213	JSON.parse("[1, 2, 3]")	parsed", f214	JSON.parse("[1, 2, 3]", (k, v) => (v === 2 ? undefined : v))
parsed and revived", f215	((...rest) => rest)(7.5, 7.5, 7.5)	rest", f216	((...rest) => rest)(7.5, 7.5, 7.5); delete a[1]
rest then delete", f217	new Array(...[3])	new Array of spread length", f218	Array(...[3])
Array of spread length", f219	Array.apply(null, [3])	Array applied", f220	Reflect.construct(Array, [3])
Array constructed", f221	new Array(pick ? 3 : 7.5)	new Array of number or item", f222	new Array(pick ? 7.5 : 3)`,
        (n, a, b, c, d) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | ${a});
function f${2 * n + 182}() {
  const a = ${b};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | ${c});
function f${2 * n + 183}() {
  const a = ${d};`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | new Array of item or number", f223);
function f224() {
  class Rows extends Array {} const a = new Rows(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | subclass of length", f224);
function f225() {
  class Rows extends Array {} const a = new Rows(7.5, 7.5);`,
      [
        `subclass of items", f225	[7.5, 7.5, , ]
literal with elision at end", f226	[...[1.5, 2.5, 3.5, 4.5], , 7.5]
spread then elision", f227	[1.5, , 3.5, 4.5].slice(0).slice(0)
slice of slice of holes", f228	[1.5, 2.5, 3.5, 4.5].concat([1.5, 2.5, 3.5, 4.5].concat([1.5, , 3.5, 4.5]))
concat of concat of holes", f229	(pick ? [1.5, , 3.5, 4.5] : [1.5, 2.5, 3.5, 4.5]).slice(0)
slice of either", f230	Object.entries({ p: 7.5, q: 7.5 })[1]
entries", f231	Reflect.ownKeys({ p: 1, q: 2 })
own keys", f232	Object.getOwnPropertyNames({ p: 1, q: 2 })
names", f233	"p1q22r".split(/\\d/)
split by pattern", f234	"p1q".split(/(\\d)|(x)/)
split with groups", f235	"p1q".match(/(\\d)|(x)/)
match", f236	[1.5, 2.5, 3.5, 4.5].with(0, 7.5); delete a[2]
with then delete", f237	[1.5, 2.5, 3.5, 4.5].toSpliced(0, 1); a.length = 5
toSpliced then longer", f238	["p", "q", "r", "s"]`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | ${a});
function f${n + 226}() {
  const a = ${b};`,
      ],
      [
        `= a.length + 1	one", f239	++	increment", f240
+= 2	two", f241	 = "6"	from text", f242`,
        (n, a, b, c, d) => `  a.length ${a};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | length plus ${b});
function f${2 * n + 240}() {
  const a = ["p", "q", "r", "s"];
  a.length${c};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | length ${d});
function f${2 * n + 241}() {
  const a = ["p", "q", "r", "s"];`,
      ],
      [
        `{ valueOf() { return 6; } }	length from object", f243
0; a[1] = "t"	emptied, stored at one", f244
0; a.push("t"); a.push("t")	emptied, pushed", f245
1; a.length = 3	shorter, longer", f246`,
        (n, a, b) => `  a.length = ${a};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | ${b});
function f${n + 244}() {
  const a = ["p", "q", "r", "s"];`,
      ],
      `  delete a[0];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | delete first", f247);
function f248() {
  const a = ["p", "q", "r", "s"];
  delete a[a.length - 1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | delete last", f248);
function f249() {
  const a = ["p", "q", "r", "s"];
  for (let k = 0; k < a.length; k += 2) delete a[k];`,
      [
        `delete by variable", f249	a.length + 1
store above length", f250	a.length
store at length", f251	40`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | ${a});
function f${n + 250}() {
  const a = ["p", "q", "r", "s"];
  a[${b}] = "t";`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | store far", f252);
function f253() {
  const a = ["p", "q", "r", "s"];
  a[200000] = "t"; a.length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | store very far", f253);
function f254() {
  const a = ["p", "q", "r", "s"];
  a[1] = "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | store inside", f254);
function f255() {
  const a = ["p", "q", "r", "s"];
  a["6"] = "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | store under text", f255);
function f256() {
  const a = ["p", "q", "r", "s"];
  Object.defineProperty(a, 6, { value: "t", writable: true, enumerable: true, configurable: true });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | define above length", f256);
function f257() {
  const a = ["p", "q", "r", "s"];
  Object.defineProperty(a, "length", { value: 6 });`,
      [
        `define length", f257	set(a, 6, "t"
reflect set", f258	set(a, "length", 6
reflect set length", f259	deleteProperty(a, 1`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | ${a});
function f${n + 258}() {
  const a = ["p", "q", "r", "s"];
  Reflect.${b});`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | reflect delete", f260);
function f261() {
  const a = ["p", "q", "r", "s"];
  Object.assign(a, { 6: "t" });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | assign", f261);
function f262() {
  const a = ["p", "q", "r", "s"];
  [a[6]] = ["t"];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | pattern target", f262);
function f263() {
  const a = ["p", "q", "r", "s"];
  [a[0], a[1]] = [a[1], a[0]];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | swap", f263);
function f264() {
  const a = ["p", "q", "r", "s"];
  const b = a; delete b[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | alias", f264);
function f265() {
  const a = ["p", "q", "r", "s"];
  const o = { list: a }; delete o.list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | alias in object", f265);
function f266() {
  const a = ["p", "q", "r", "s"];
  const f = () => { delete a[1]; }; f();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | alias in closure", f266);
function f267() {
  const a = ["p", "q", "r", "s"];
  deleteSecond(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | callee deletes", f267);
function f268() {
  const a = ["p", "q", "r", "s"];
  lengthen(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | callee lengthens", f268);
function f269() {
  const a = ["p", "q", "r", "s"];
  (function () { delete arguments[0][1]; })(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | through arguments", f269);
function f270() {
  const a = ["p", "q", "r", "s"];
  const p = new Proxy(a, {}); delete p[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | through proxy", f270);
function f271() {
  const a = ["p", "q", "r", "s"];
  const p = new Proxy(a, {}); p.length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | through proxy length", f271);
function f272() {
  const a = ["p", "q", "r", "s"];
  Array.prototype.pop.call(a);`,
      [
        `pop call", f272	push("t"); a.pop(); a.shift(); a.unshift(	push, pop, shift, unshift", f273	, 2
splice out", f274	splice(1, 0, 	splice in", f275	0, 0, "t"`,
        (n, a, b, c, d) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | ${a});
function f${2 * n + 273}() {
  const a = ["p", "q", "r", "s"];
  a.${b}"t", "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | ${c});
function f${2 * n + 274}() {
  const a = ["p", "q", "r", "s"];
  a.splice(1${d});`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | splice beyond", f276);
function f277() {
  const a = ["p", "q", "r", "s"];
  a.splice(1, 0, ...["p", , "r", "s"]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | splice in holes", f277);
function f278() {
  const a = ["p", "q", "r", "s"];
  a.reverse();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | reverse", f278);
function f279() {
  const a = ["p", "q", "r", "s"];
  a.fill("t", 1, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | fill", f279);
function f280() {
  const a = ["p", "q", "r", "s"];
  a.fill("t", 2, 10);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | fill beyond", f280);
function f281() {
  const a = ["p", "q", "r", "s"];
  a.copyWithin(0, 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | copyWithin", f281);
function f282() {
  const a = ["p", "q", "r", "s"];
  a.sort();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | sort", f282);
function f283() {
  const a = ["p", "q", "r", "s"];
  a.sort((x, y) => { delete a[0]; return x < y ? -1 : x > y ? 1 : 0; });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | sort that deletes", f283);
function f284() {
  const a = ["p", "q", "r", "s"];
  a.push(...["p", , "r", "s"]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | push spread holes", f284);
function f285() {
  const a = ["p", "q", "r", "s"];
  const p = new Proxy(a, {}); p[6] = "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | through proxy store", f285);
function f286() {
  const a = ["p", "q", "r", "s"];
  Reflect.set(new Proxy(a, {}), 6, "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | through proxy reflect", f286);
function f287() {
  const a = ["p", "q", "r", "s"];
  Reflect.set({}, 6, "t", a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | reflect set with receiver", f287);
function f288() {
  const a = ["p", "q", "r", "s"];
  const heir = Object.create(a); Reflect.set(heir, 6, "t", a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | reflect set on heir", f288);
function f289() {
  const a = ["p", "q", "r", "s"];
  for (a[6] of ["t"]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | loop target", f289);
function f290() {
  const a = ["p", "q", "r", "s"];
  for (a[6] in { p: 1 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | loop target in", f290);
function f291() {
  const a = ["p", "q", "r", "s"];
  Object.defineProperties(a, { 6: { value: "t", writable: true, enumerable: true, configurable: true } });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | define properties", f291);
function f292() {
  const a = ["p", "q", "r", "s"];
  const k = "" + (a.length + 2); a[k] = "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | computed text key", f292);
function f293() {
  const a = ["p", "q", "r", "s"];
  const k = { toString() { return "6"; } }; a[k] = "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | key from object", f293);
function f294() {
  const a = ["p", "q", "r", "s"];
  a[6]++;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | increment above", f294);
function f295() {
  const a = ["p", "q", "r", "s"];
  a[6] ||= "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | assign or above", f295);
function f296() {
  const a = ["p", "q", "r", "s"];
  const rows = [a]; delete rows[0][1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | in a holder array", f296);
function f297() {
  const a = ["p", "q", "r", "s"];
  for (const list of new Set([a])) delete list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | in a set", f297);
function f298() {
  const a = ["p", "q", "r", "s"];
  same(a).length = 6;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | returned by callee", f298);
function f299() {
  const a = ["p", "q", "r", "s"];
  (function () { delete this[1]; }).call(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | bound this", f299);
function f300() {
  const a = ["p", "q", "r", "s"];
  const o = { get list() { return a; } }; delete o.list[1];`,
      [
        `with a getter", f300	pick ? ["p", "q", "r", "s"] : Array(3)	literal or Array(n)", f301	pick ? ["p", "q", "r", "s"] : new Array(3)
literal or new Array(n)", f302	!pick ? ["p", "q", "r", "s"] : new Array(3)	Array(n) or literal", f303	new Array("t", "t", "t")
new Array of items", f304	Array.of("t", "t")	Array.of", f305	["p", "q", "r", "s"].concat(["p", , "r", "s"])
concat holes", f306	["p", , "r", "s"].concat(["p", "q", "r", "s"])	holes concat", f307	["p", "q", "r", "s"].concat(["p", "q", "r", "s"], "t")
concat whole", f308	["p", "q", "r", "s"].concat({ length: 3, 0: "t", [Symbol.isConcatSpreadable]: true })	concat array-like", f309	[...["p", , "r", "s"]]
spread holes", f310	[...["p", "q", "r", "s"], "t"]	spread whole", f311	Array.from({ length: 3 })
from length", f312	Array.from(["p", , "r", "s"])	from holes", f313	["p", , "r", "s"].slice(0, 3)
slice holes", f314	["p", "q", "r", "s"].slice(1)	slice whole", f315	["p", , "r", "s"].splice(0, 3)
splice result holes", f316	["p", "q", "r", "s"].splice(0, 3)	splice result whole", f317	["p", , "r", "s"].fill("t")
holes filled", f318	["p", , "r", "s"].fill("t", 2)	holes part filled", f319	["p", , "r", "s"].copyWithin(2, 0)
holes copyWithin", f320	["p", , "r", "s"].sort()	holes sorted", f321	["p", , "r", "s"].reverse()
holes reversed", f322	["p", , "r", "s"].toReversed()	holes toReversed", f323	["p", , "r", "s"].toSorted()
holes toSorted", f324	["p", , "r", "s"].toSpliced(0, 1)	holes toSpliced", f325	["p", , "r", "s"].with(0, "t")
holes with", f326	["p", , "r", "s"].flat()	holes flat", f327	Object.keys({ p: 1, q: 2, r: 3 }); delete a[1]
keys then delete", f328	Object.keys({ p: 1, q: 2, r: 3 })	keys", f329	Object.values({ p: "t", q: "t" })
values", f330	"p,q,,r".split(",")	split", f331	"p,q".split(","); a.length = 4
split then longer", f332	JSON.parse("[1, 2, 3]")	parsed", f333	JSON.parse("[1, 2, 3]", (k, v) => (v === 2 ? undefined : v))
parsed and revived", f334	((...rest) => rest)("t", "t", "t")	rest", f335	((...rest) => rest)("t", "t", "t"); delete a[1]
rest then delete", f336	new Array(...[3])	new Array of spread length", f337	Array(...[3])
Array of spread length", f338	Array.apply(null, [3])	Array applied", f339	Reflect.construct(Array, [3])
Array constructed", f340	new Array(pick ? 3 : "t")	new Array of number or item", f341	new Array(pick ? "t" : 3)`,
        (n, a, b, c, d) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | ${a});
function f${2 * n + 301}() {
  const a = ${b};
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | ${c});
function f${2 * n + 302}() {
  const a = ${d};`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | new Array of item or number", f342);
function f343() {
  class Rows extends Array {} const a = new Rows(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | subclass of length", f343);
function f344() {
  class Rows extends Array {} const a = new Rows("t", "t");`,
      [
        `subclass of items", f344	["t", "t", , ]
literal with elision at end", f345	[...["p", "q", "r", "s"], , "t"]
spread then elision", f346	["p", , "r", "s"].slice(0).slice(0)
slice of slice of holes", f347	["p", "q", "r", "s"].concat(["p", "q", "r", "s"].concat(["p", , "r", "s"]))
concat of concat of holes", f348	(pick ? ["p", , "r", "s"] : ["p", "q", "r", "s"]).slice(0)
slice of either", f349	Object.entries({ p: "t", q: "t" })[1]
entries", f350	Reflect.ownKeys({ p: 1, q: 2 })
own keys", f351	Object.getOwnPropertyNames({ p: 1, q: 2 })
names", f352	"p1q22r".split(/\\d/)
split by pattern", f353	"p1q".split(/(\\d)|(x)/)
split with groups", f354	"p1q".match(/(\\d)|(x)/)
match", f355	["p", "q", "r", "s"].with(0, "t"); delete a[2]
with then delete", f356	["p", "q", "r", "s"].toSpliced(0, 1); a.length = 5`,
        (n, a, b) => `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | ${a});
function f${n + 345}() {
  const a = ${b};`,
      ],
      `  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | toSpliced then longer", f357);
console.log(lines.join("\\n"));
`,
    ),
    "every-array-method-on-a-frozen-constant-array-of-mixed-values.js": text(
      `// Every method of Array.prototype, and what else reads a list, on a frozen constant array of mixed values: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
function show(v) {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0() { const S = Object.freeze(["a", 2, null]); const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(S) { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2() { const S = Object.freeze(["a", 2, null]); const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	3(S) { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4() { const S = Object.freeze(["a", 2, null]); const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S) { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6() { const S = Object.freeze(["a", 2, null]); const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(S) { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
8() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	9(S) { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	10() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	11(S) { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	12() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	13(S) { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	14() { const S = Object.freeze(["a", 2, null]); const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	15(S) { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")
16() { const S = Object.freeze(["a", 2, null]); const r = S.find(p => p !== undefined); return typeof r + ":" + r	17(S) { const r = S.find(p => p !== undefined); return typeof r + ":" + r	18() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	19(S) { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	20() { const S = Object.freeze(["a", 2, null]); const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	21(S) { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	22() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	23(S) { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
24() { const S = Object.freeze(["a", 2, null]); const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	25(S) { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	26() { const S = Object.freeze(["a", 2, null]); const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	27(S) { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	28() { const S = Object.freeze(["a", 2, null]); let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	29(S) { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	30() { const S = Object.freeze(["a", 2, null]); let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	31(S) { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t
32() { const S = Object.freeze(["a", 2, null]); return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	33(S) { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	34() { const S = Object.freeze(["a", 2, null]); return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	35(S) { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	36() { const S = Object.freeze(["a", 2, null]); return S.join("+") + "|" + S.join()	37(S) { return S.join("+") + "|" + S.join()	38() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	39(S) { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t
40() { const S = Object.freeze(["a", 2, null]); const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S) { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42() { const S = Object.freeze(["a", 2, null]); return S.map(p => p + p).join()	43(S) { return S.map(p => p + p).join()	44() { const S = Object.freeze(["a", 2, null]); return S.map(p => typeof p).join()	45(S) { return S.map(p => typeof p).join()	46() { const S = Object.freeze(["a", 2, null]); const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	47(S) { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
48() { const S = Object.freeze(["a", 2, null]); return S.reduce((t, p, i) => t + typeof p + p + i, "")	49(S) { return S.reduce((t, p, i) => t + typeof p + p + i, "")	50() { const S = Object.freeze(["a", 2, null]); const r = S.reduce((a, b) => a); return typeof r + ":" + r	51(S) { const r = S.reduce((a, b) => a); return typeof r + ":" + r	52() { const S = Object.freeze(["a", 2, null]); return S.reduceRight((t, p) => t + typeof p + p, "")	53(S) { return S.reduceRight((t, p) => t + typeof p + p, "")	54() { const S = Object.freeze(["a", 2, null]); const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	55(S) { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
56() { const S = Object.freeze(["a", 2, null]); const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	57(S) { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	58() { const S = Object.freeze(["a", 2, null]); let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	59(S) { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	60() { const S = Object.freeze(["a", 2, null]); const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(S) { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62() { const S = Object.freeze(["a", 2, null]); const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	63(S) { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
64() { const S = Object.freeze(["a", 2, null]); const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	65(S) { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	66() { const S = Object.freeze(["a", 2, null]); const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	67(S) { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	68() { const S = Object.freeze(["a", 2, null]); return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	69(S) { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	70() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	71(S) { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
72() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const p of S) t += typeof p + p + ","; return t	73(S) { let t = ""; for (const p of S) t += typeof p + p + ","; return t	74() { const S = Object.freeze(["a", 2, null]); let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	75(S) { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	76() { const S = Object.freeze(["a", 2, null]); let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	77(S) { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	78() { const S = Object.freeze(["a", 2, null]); const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	79(S) { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
80() { const S = Object.freeze(["a", 2, null]); const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	81(S) { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	82() { const S = Object.freeze(["a", 2, null]); const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	83(S) { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	84() { const S = Object.freeze(["a", 2, null]); const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	85(S) { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	86() { const S = Object.freeze(["a", 2, null]); const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	87(S) { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
88() { const S = Object.freeze(["a", 2, null]); const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	89(S) { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	90() { const S = Object.freeze(["a", 2, null]); const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(S) { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92() { const S = Object.freeze(["a", 2, null]); const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	93(S) { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	94() { const S = Object.freeze(["a", 2, null]); return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	95(S) { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
96() { const S = Object.freeze(["a", 2, null]); const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(S) { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98() { const S = Object.freeze(["a", 2, null]); const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	99(S) { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	100() { const S = Object.freeze(["a", 2, null]); return JSON.stringify(S)	101(S) { return JSON.stringify(S)	102() { const S = Object.freeze(["a", 2, null]); const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	103(S) { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])
104() { const S = Object.freeze(["a", 2, null]); const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	105(S) { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	106() { const S = Object.freeze(["a", 2, null]); const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	107(S) { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	108() { const S = Object.freeze(["a", 2, null]); const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	109(S) { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	110() { const S = Object.freeze(["a", 2, null]); return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	111(S) { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)
112() { const S = Object.freeze(["a", 2, null]); return String.raw({ raw: S }, 1, 2)	113(S) { return String.raw({ raw: S }, 1, 2)	114() { const S = Object.freeze(["a", 2, null]); const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	115(S) { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	116() { const S = Object.freeze(["a", 2, null]); return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	117(S) { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	118() { const S = Object.freeze(["a", 2, null]); const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	119(S) { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
120() { const S = Object.freeze(["a", 2, null]); S.push("x"); return "pushed"	121(S) { S.push("x"); return "pushed"	122() { const S = Object.freeze(["a", 2, null]); return "popped " + S.pop()	123(S) { return "popped " + S.pop()	124() { const S = Object.freeze(["a", 2, null]); return "shifted " + S.shift()	125(S) { return "shifted " + S.shift()	126() { const S = Object.freeze(["a", 2, null]); S.unshift("x"); return "unshifted"	127(S) { S.unshift("x"); return "unshifted"
128() { const S = Object.freeze(["a", 2, null]); return show(S.reverse())	129(S) { return show(S.reverse())	130() { const S = Object.freeze(["a", 2, null]); return show(S.sort())	131(S) { return show(S.sort())	132() { const S = Object.freeze(["a", 2, null]); return show(S.splice(0, 1))	133(S) { return show(S.splice(0, 1))	134() { const S = Object.freeze(["a", 2, null]); return show(S.fill("f"))	135(S) { return show(S.fill("f"))
136() { const S = Object.freeze(["a", 2, null]); return show(S.copyWithin(0, 1))	137(S) { return show(S.copyWithin(0, 1))	138() { const S = Object.freeze(["a", 2, null]); "use strict"; S[0] = "x"; return "stored"	139(S) { "use strict"; S[0] = "x"; return "stored"	140() { const S = Object.freeze(["a", 2, null]); return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	141(S) { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	142() { const S = Object.freeze(["a", 2, null]); const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	143(S) { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h) => `
function c${a}; }

function hc${b}; }
function c${8 * n + 1}() { return hc${8 * n + 1}(Object.freeze(["a", 2, null])); }

function c${c}; }

function hc${d}; }
function c${8 * n + 3}() { return hc${8 * n + 3}(Object.freeze(["a", 2, null])); }

function c${e}; }

function hc${f}; }
function c${8 * n + 5}() { return hc${8 * n + 5}(Object.freeze(["a", 2, null])); }

function c${g}; }

function hc${h}; }
function c${8 * n + 7}() { return hc${8 * n + 7}(Object.freeze(["a", 2, null])); }`,
      ],
      `const cases = [["at here", c0], ["at helper", c1], ["concat here", c2], ["concat helper", c3], ["concat-more here", c4], ["concat-more helper", c5], ["concat-onto here", c6], ["concat-onto helper", c7], ["entries here", c8], ["entries helper", c9], ["every here", c10], ["every helper", c11], ["filter here", c12], ["filter helper", c13], ["filter-length here", c14], ["filter-length helper", c15], ["find here", c16], ["find helper", c17], ["findIndex here", c18], ["findIndex helper", c19], ["findLast here", c20], ["findLast helper", c21], ["findLastIndex here", c22], ["findLastIndex helper", c23], ["flat here", c24], ["flat helper", c25], ["flatMap here", c26], ["flatMap helper", c27], ["forEach here", c28], ["forEach helper", c29], ["forEach-method here", c30], ["forEach-method helper", c31], ["includes here", c32], ["includes helper", c33], ["indexOf here", c34], ["indexOf helper", c35], ["join here", c36], ["join helper", c37], ["keys here", c38], ["keys helper", c39], ["map here", c40], ["map helper", c41], ["map-join here", c42], ["map-join helper", c43], ["map-typeof here", c44], ["map-typeof helper", c45], ["map-index here", c46], ["map-index helper", c47], ["reduce here", c48], ["reduce helper", c49], ["reduce-first here", c50], ["reduce-first helper", c51], ["reduceRight here", c52], ["reduceRight helper", c53], ["slice here", c54], ["slice helper", c55], ["slice-1 here", c56], ["slice-1 helper", c57], ["some here", c58], ["some helper", c59], ["toReversed here", c60], ["toReversed helper", c61], ["toSorted here", c62], ["toSorted helper", c63], ["toSpliced here", c64], ["toSpliced helper", c65], ["with here", c66], ["with helper", c67], ["toString here", c68], ["toString helper", c69], ["values here", c70], ["values helper", c71], ["for-of here", c72], ["for-of helper", c73], ["for-in here", c74], ["for-in helper", c75], ["index-loop here", c76], ["index-loop helper", c77], ["spread here", c78], ["spread helper", c79], ["spread-call here", c80], ["spread-call helper", c81], ["destructure here", c82], ["destructure helper", c83], ["Array.from here", c84], ["Array.from helper", c85], ["Array.from-map here", c86], ["Array.from-map helper", c87], ["Array.of here", c88], ["Array.of helper", c89], ["Object.values here", c90], ["Object.values helper", c91], ["Object.entries here", c92], ["Object.entries helper", c93], ["Object.keys here", c94], ["Object.keys helper", c95], ["Object.assign here", c96], ["Object.assign helper", c97], ["object-spread here", c98], ["object-spread helper", c99], ["JSON here", c100], ["JSON helper", c101], ["Set here", c102], ["Set helper", c103], ["Map here", c104], ["Map helper", c105], ["call-map here", c106], ["call-map helper", c107], ["call-slice here", c108], ["call-slice helper", c109], ["apply here", c110], ["apply helper", c111], ["String.raw here", c112], ["String.raw helper", c113], ["structuredClone here", c114], ["structuredClone helper", c115], ["isArray here", c116], ["isArray helper", c117], ["descriptor here", c118], ["descriptor helper", c119], ["push here", c120], ["push helper", c121], ["pop here", c122], ["pop helper", c123], ["shift here", c124], ["shift helper", c125], ["unshift here", c126], ["unshift helper", c127], ["reverse here", c128], ["reverse helper", c129], ["sort here", c130], ["sort helper", c131], ["splice here", c132], ["splice helper", c133], ["fill here", c134], ["fill helper", c135], ["copyWithin here", c136], ["copyWithin helper", c137], ["store here", c138], ["store helper", c139], ["chain here", c140], ["chain helper", c141], ["then-read here", c142], ["then-read helper", c143]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-a-frozen-constant-array-of-mixed-values.ts": text(
      `// Every method of Array.prototype, and what else reads a list, on a frozen constant array of mixed values: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
// @ts-nocheck
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(S: readonly (string | number | null)[]): string { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	3(S: readonly (string | number | null)[]): string { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(): string { const S: any = Object.freeze(["a", 2, null]); const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S: any): string { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(S: readonly (string | number | null)[]): string { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
8(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	9(S: readonly (string | number | null)[]): string { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	10(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	11(S: readonly (string | number | null)[]): string { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	12(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	13(S: readonly (string | number | null)[]): string { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	14(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	15(S: readonly (string | number | null)[]): string { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")
16(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.find(p => p !== undefined); return typeof r + ":" + r	17(S: readonly (string | number | null)[]): string { const r = S.find(p => p !== undefined); return typeof r + ":" + r	18(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	19(S: readonly (string | number | null)[]): string { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	20(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	21(S: readonly (string | number | null)[]): string { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	22(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	23(S: readonly (string | number | null)[]): string { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
24(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	25(S: readonly (string | number | null)[]): string { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	26(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	27(S: readonly (string | number | null)[]): string { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	28(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	29(S: readonly (string | number | null)[]): string { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	30(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	31(S: readonly (string | number | null)[]): string { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t
32(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	33(S: readonly (string | number | null)[]): string { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	34(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	35(S: readonly (string | number | null)[]): string { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	36(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return S.join("+") + "|" + S.join()	37(S: readonly (string | number | null)[]): string { return S.join("+") + "|" + S.join()	38(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	39(S: readonly (string | number | null)[]): string { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t
40(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S: readonly (string | number | null)[]): string { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return S.map(p => p + p).join()	43(S: readonly (string | number | null)[]): string { return S.map(p => p + p).join()	44(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return S.map(p => typeof p).join()	45(S: readonly (string | number | null)[]): string { return S.map(p => typeof p).join()	46(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	47(S: readonly (string | number | null)[]): string { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
48(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return S.reduce((t, p, i) => t + typeof p + p + i, "")	49(S: readonly (string | number | null)[]): string { return S.reduce((t, p, i) => t + typeof p + p + i, "")	50(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.reduce((a, b) => a); return typeof r + ":" + r	51(S: readonly (string | number | null)[]): string { const r = S.reduce((a, b) => a); return typeof r + ":" + r	52(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return S.reduceRight((t, p) => t + typeof p + p, "")	53(S: readonly (string | number | null)[]): string { return S.reduceRight((t, p) => t + typeof p + p, "")	54(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	55(S: readonly (string | number | null)[]): string { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
56(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	57(S: readonly (string | number | null)[]): string { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	58(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	59(S: readonly (string | number | null)[]): string { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	60(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(S: readonly (string | number | null)[]): string { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	63(S: readonly (string | number | null)[]): string { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
64(): string { const S: any = Object.freeze(["a", 2, null]); const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	65(S: any): string { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	66(): string { const S: any = Object.freeze(["a", 2, null]); const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	67(S: any): string { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	68(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	69(S: readonly (string | number | null)[]): string { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	70(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	71(S: readonly (string | number | null)[]): string { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
72(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; for (const p of S) t += typeof p + p + ","; return t	73(S: readonly (string | number | null)[]): string { let t = ""; for (const p of S) t += typeof p + p + ","; return t	74(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	75(S: readonly (string | number | null)[]): string { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	76(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	77(S: readonly (string | number | null)[]): string { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	78(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	79(S: readonly (string | number | null)[]): string { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
80(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	81(S: readonly (string | number | null)[]): string { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	82(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	83(S: readonly (string | number | null)[]): string { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	84(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	85(S: readonly (string | number | null)[]): string { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	86(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	87(S: readonly (string | number | null)[]): string { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
88(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	89(S: readonly (string | number | null)[]): string { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	90(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(S: readonly (string | number | null)[]): string { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	93(S: readonly (string | number | null)[]): string { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	94(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	95(S: readonly (string | number | null)[]): string { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
96(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(S: readonly (string | number | null)[]): string { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	99(S: readonly (string | number | null)[]): string { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	100(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return JSON.stringify(S)	101(S: readonly (string | number | null)[]): string { return JSON.stringify(S)	102(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	103(S: readonly (string | number | null)[]): string { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])
104(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	105(S: readonly (string | number | null)[]): string { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	106(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	107(S: readonly (string | number | null)[]): string { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	108(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	109(S: readonly (string | number | null)[]): string { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	110(): string { const S: any = Object.freeze(["a", 2, null]); return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	111(S: any): string { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)
112(): string { const S: any = Object.freeze(["a", 2, null]); return String.raw({ raw: S }, 1, 2)	113(S: any): string { return String.raw({ raw: S }, 1, 2)	114(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	115(S: readonly (string | number | null)[]): string { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	116(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	117(S: readonly (string | number | null)[]): string { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	118(): string { const S: readonly (string | number | null)[] = Object.freeze(["a", 2, null]); const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	119(S: readonly (string | number | null)[]): string { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
120(): string { const S: any = Object.freeze(["a", 2, null]); S.push("x"); return "pushed"	121(S: any): string { S.push("x"); return "pushed"	122(): string { const S: any = Object.freeze(["a", 2, null]); return "popped " + S.pop()	123(S: any): string { return "popped " + S.pop()	124(): string { const S: any = Object.freeze(["a", 2, null]); return "shifted " + S.shift()	125(S: any): string { return "shifted " + S.shift()	126(): string { const S: any = Object.freeze(["a", 2, null]); S.unshift("x"); return "unshifted"	127(S: any): string { S.unshift("x"); return "unshifted"
128(): string { const S: any = Object.freeze(["a", 2, null]); return show(S.reverse())	129(S: any): string { return show(S.reverse())	130(): string { const S: any = Object.freeze(["a", 2, null]); return show(S.sort())	131(S: any): string { return show(S.sort())	132(): string { const S: any = Object.freeze(["a", 2, null]); return show(S.splice(0, 1))	133(S: any): string { return show(S.splice(0, 1))	134(): string { const S: any = Object.freeze(["a", 2, null]); return show(S.fill("f"))	135(S: any): string { return show(S.fill("f"))
136(): string { const S: any = Object.freeze(["a", 2, null]); return show(S.copyWithin(0, 1))	137(S: any): string { return show(S.copyWithin(0, 1))	138(): string { const S: any = Object.freeze(["a", 2, null]); "use strict"; S[0] = "x"; return "stored"	139(S: any): string { "use strict"; S[0] = "x"; return "stored"	140(): string { const S: any = Object.freeze(["a", 2, null]); return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	141(S: any): string { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	142(): string { const S: any = Object.freeze(["a", 2, null]); const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	143(S: any): string { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h) => `
function c${a}; }

function hc${b}; }
function c${8 * n + 1}(): string { return hc${8 * n + 1}(Object.freeze(["a", 2, null])); }

function c${c}; }

function hc${d}; }
function c${8 * n + 3}(): string { return hc${8 * n + 3}(Object.freeze(["a", 2, null])); }

function c${e}; }

function hc${f}; }
function c${8 * n + 5}(): string { return hc${8 * n + 5}(Object.freeze(["a", 2, null])); }

function c${g}; }

function hc${h}; }
function c${8 * n + 7}(): string { return hc${8 * n + 7}(Object.freeze(["a", 2, null])); }`,
      ],
      `const cases: [string, () => string][] = [["at here", c0], ["at helper", c1], ["concat here", c2], ["concat helper", c3], ["concat-more here", c4], ["concat-more helper", c5], ["concat-onto here", c6], ["concat-onto helper", c7], ["entries here", c8], ["entries helper", c9], ["every here", c10], ["every helper", c11], ["filter here", c12], ["filter helper", c13], ["filter-length here", c14], ["filter-length helper", c15], ["find here", c16], ["find helper", c17], ["findIndex here", c18], ["findIndex helper", c19], ["findLast here", c20], ["findLast helper", c21], ["findLastIndex here", c22], ["findLastIndex helper", c23], ["flat here", c24], ["flat helper", c25], ["flatMap here", c26], ["flatMap helper", c27], ["forEach here", c28], ["forEach helper", c29], ["forEach-method here", c30], ["forEach-method helper", c31], ["includes here", c32], ["includes helper", c33], ["indexOf here", c34], ["indexOf helper", c35], ["join here", c36], ["join helper", c37], ["keys here", c38], ["keys helper", c39], ["map here", c40], ["map helper", c41], ["map-join here", c42], ["map-join helper", c43], ["map-typeof here", c44], ["map-typeof helper", c45], ["map-index here", c46], ["map-index helper", c47], ["reduce here", c48], ["reduce helper", c49], ["reduce-first here", c50], ["reduce-first helper", c51], ["reduceRight here", c52], ["reduceRight helper", c53], ["slice here", c54], ["slice helper", c55], ["slice-1 here", c56], ["slice-1 helper", c57], ["some here", c58], ["some helper", c59], ["toReversed here", c60], ["toReversed helper", c61], ["toSorted here", c62], ["toSorted helper", c63], ["toSpliced here", c64], ["toSpliced helper", c65], ["with here", c66], ["with helper", c67], ["toString here", c68], ["toString helper", c69], ["values here", c70], ["values helper", c71], ["for-of here", c72], ["for-of helper", c73], ["for-in here", c74], ["for-in helper", c75], ["index-loop here", c76], ["index-loop helper", c77], ["spread here", c78], ["spread helper", c79], ["spread-call here", c80], ["spread-call helper", c81], ["destructure here", c82], ["destructure helper", c83], ["Array.from here", c84], ["Array.from helper", c85], ["Array.from-map here", c86], ["Array.from-map helper", c87], ["Array.of here", c88], ["Array.of helper", c89], ["Object.values here", c90], ["Object.values helper", c91], ["Object.entries here", c92], ["Object.entries helper", c93], ["Object.keys here", c94], ["Object.keys helper", c95], ["Object.assign here", c96], ["Object.assign helper", c97], ["object-spread here", c98], ["object-spread helper", c99], ["JSON here", c100], ["JSON helper", c101], ["Set here", c102], ["Set helper", c103], ["Map here", c104], ["Map helper", c105], ["call-map here", c106], ["call-map helper", c107], ["call-slice here", c108], ["call-slice helper", c109], ["apply here", c110], ["apply helper", c111], ["String.raw here", c112], ["String.raw helper", c113], ["structuredClone here", c114], ["structuredClone helper", c115], ["isArray here", c116], ["isArray helper", c117], ["descriptor here", c118], ["descriptor helper", c119], ["push here", c120], ["push helper", c121], ["pop here", c122], ["pop helper", c123], ["shift here", c124], ["shift helper", c125], ["unshift here", c126], ["unshift helper", c127], ["reverse here", c128], ["reverse helper", c129], ["sort here", c130], ["sort helper", c131], ["splice here", c132], ["splice helper", c133], ["fill here", c134], ["fill helper", c135], ["copyWithin here", c136], ["copyWithin helper", c137], ["store here", c138], ["store helper", c139], ["chain here", c140], ["chain helper", c141], ["then-read here", c142], ["then-read helper", c143]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e as any).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-a-frozen-constant-array-of-numbers.js": text(
      `// Every method of Array.prototype, and what else reads a list, on a frozen constant array of numbers: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
function show(v) {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0() { const S = Object.freeze([1, 2, 3]); const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(S) { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2() { const S = Object.freeze([1, 2, 3]); const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	3(S) { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4() { const S = Object.freeze([1, 2, 3]); const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S) { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6() { const S = Object.freeze([1, 2, 3]); const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(S) { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
8() { const S = Object.freeze([1, 2, 3]); let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	9(S) { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	10() { const S = Object.freeze([1, 2, 3]); let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	11(S) { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	12() { const S = Object.freeze([1, 2, 3]); let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	13(S) { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	14() { const S = Object.freeze([1, 2, 3]); const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	15(S) { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")
16() { const S = Object.freeze([1, 2, 3]); const r = S.find(p => p !== undefined); return typeof r + ":" + r	17(S) { const r = S.find(p => p !== undefined); return typeof r + ":" + r	18() { const S = Object.freeze([1, 2, 3]); let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	19(S) { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	20() { const S = Object.freeze([1, 2, 3]); const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	21(S) { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	22() { const S = Object.freeze([1, 2, 3]); let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	23(S) { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
24() { const S = Object.freeze([1, 2, 3]); const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	25(S) { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	26() { const S = Object.freeze([1, 2, 3]); const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	27(S) { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	28() { const S = Object.freeze([1, 2, 3]); let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	29(S) { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	30() { const S = Object.freeze([1, 2, 3]); let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	31(S) { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t
32() { const S = Object.freeze([1, 2, 3]); return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	33(S) { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	34() { const S = Object.freeze([1, 2, 3]); return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	35(S) { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	36() { const S = Object.freeze([1, 2, 3]); return S.join("+") + "|" + S.join()	37(S) { return S.join("+") + "|" + S.join()	38() { const S = Object.freeze([1, 2, 3]); let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	39(S) { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t
40() { const S = Object.freeze([1, 2, 3]); const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S) { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42() { const S = Object.freeze([1, 2, 3]); return S.map(p => p + p).join()	43(S) { return S.map(p => p + p).join()	44() { const S = Object.freeze([1, 2, 3]); return S.map(p => typeof p).join()	45(S) { return S.map(p => typeof p).join()	46() { const S = Object.freeze([1, 2, 3]); const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	47(S) { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
48() { const S = Object.freeze([1, 2, 3]); return S.reduce((t, p, i) => t + typeof p + p + i, "")	49(S) { return S.reduce((t, p, i) => t + typeof p + p + i, "")	50() { const S = Object.freeze([1, 2, 3]); const r = S.reduce((a, b) => a); return typeof r + ":" + r	51(S) { const r = S.reduce((a, b) => a); return typeof r + ":" + r	52() { const S = Object.freeze([1, 2, 3]); return S.reduceRight((t, p) => t + typeof p + p, "")	53(S) { return S.reduceRight((t, p) => t + typeof p + p, "")	54() { const S = Object.freeze([1, 2, 3]); const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	55(S) { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
56() { const S = Object.freeze([1, 2, 3]); const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	57(S) { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	58() { const S = Object.freeze([1, 2, 3]); let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	59(S) { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	60() { const S = Object.freeze([1, 2, 3]); const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(S) { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62() { const S = Object.freeze([1, 2, 3]); const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	63(S) { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
64() { const S = Object.freeze([1, 2, 3]); const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	65(S) { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	66() { const S = Object.freeze([1, 2, 3]); const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	67(S) { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	68() { const S = Object.freeze([1, 2, 3]); return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	69(S) { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	70() { const S = Object.freeze([1, 2, 3]); let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	71(S) { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
72() { const S = Object.freeze([1, 2, 3]); let t = ""; for (const p of S) t += typeof p + p + ","; return t	73(S) { let t = ""; for (const p of S) t += typeof p + p + ","; return t	74() { const S = Object.freeze([1, 2, 3]); let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	75(S) { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	76() { const S = Object.freeze([1, 2, 3]); let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	77(S) { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	78() { const S = Object.freeze([1, 2, 3]); const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	79(S) { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
80() { const S = Object.freeze([1, 2, 3]); const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	81(S) { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	82() { const S = Object.freeze([1, 2, 3]); const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	83(S) { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	84() { const S = Object.freeze([1, 2, 3]); const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	85(S) { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	86() { const S = Object.freeze([1, 2, 3]); const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	87(S) { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
88() { const S = Object.freeze([1, 2, 3]); const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	89(S) { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	90() { const S = Object.freeze([1, 2, 3]); const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(S) { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92() { const S = Object.freeze([1, 2, 3]); const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	93(S) { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	94() { const S = Object.freeze([1, 2, 3]); return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	95(S) { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
96() { const S = Object.freeze([1, 2, 3]); const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(S) { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98() { const S = Object.freeze([1, 2, 3]); const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	99(S) { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	100() { const S = Object.freeze([1, 2, 3]); return JSON.stringify(S)	101(S) { return JSON.stringify(S)	102() { const S = Object.freeze([1, 2, 3]); const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	103(S) { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])
104() { const S = Object.freeze([1, 2, 3]); const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	105(S) { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	106() { const S = Object.freeze([1, 2, 3]); const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	107(S) { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	108() { const S = Object.freeze([1, 2, 3]); const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	109(S) { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	110() { const S = Object.freeze([1, 2, 3]); return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	111(S) { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)
112() { const S = Object.freeze([1, 2, 3]); return String.raw({ raw: S }, 1, 2)	113(S) { return String.raw({ raw: S }, 1, 2)	114() { const S = Object.freeze([1, 2, 3]); const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	115(S) { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	116() { const S = Object.freeze([1, 2, 3]); return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	117(S) { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	118() { const S = Object.freeze([1, 2, 3]); const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	119(S) { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
120() { const S = Object.freeze([1, 2, 3]); S.push("x"); return "pushed"	121(S) { S.push("x"); return "pushed"	122() { const S = Object.freeze([1, 2, 3]); return "popped " + S.pop()	123(S) { return "popped " + S.pop()	124() { const S = Object.freeze([1, 2, 3]); return "shifted " + S.shift()	125(S) { return "shifted " + S.shift()	126() { const S = Object.freeze([1, 2, 3]); S.unshift("x"); return "unshifted"	127(S) { S.unshift("x"); return "unshifted"
128() { const S = Object.freeze([1, 2, 3]); return show(S.reverse())	129(S) { return show(S.reverse())	130() { const S = Object.freeze([1, 2, 3]); return show(S.sort())	131(S) { return show(S.sort())	132() { const S = Object.freeze([1, 2, 3]); return show(S.splice(0, 1))	133(S) { return show(S.splice(0, 1))	134() { const S = Object.freeze([1, 2, 3]); return show(S.fill("f"))	135(S) { return show(S.fill("f"))
136() { const S = Object.freeze([1, 2, 3]); return show(S.copyWithin(0, 1))	137(S) { return show(S.copyWithin(0, 1))	138() { const S = Object.freeze([1, 2, 3]); "use strict"; S[0] = "x"; return "stored"	139(S) { "use strict"; S[0] = "x"; return "stored"	140() { const S = Object.freeze([1, 2, 3]); return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	141(S) { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	142() { const S = Object.freeze([1, 2, 3]); const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	143(S) { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h) => `
function c${a}; }

function hc${b}; }
function c${8 * n + 1}() { return hc${8 * n + 1}(Object.freeze([1, 2, 3])); }

function c${c}; }

function hc${d}; }
function c${8 * n + 3}() { return hc${8 * n + 3}(Object.freeze([1, 2, 3])); }

function c${e}; }

function hc${f}; }
function c${8 * n + 5}() { return hc${8 * n + 5}(Object.freeze([1, 2, 3])); }

function c${g}; }

function hc${h}; }
function c${8 * n + 7}() { return hc${8 * n + 7}(Object.freeze([1, 2, 3])); }`,
      ],
      `const cases = [["at here", c0], ["at helper", c1], ["concat here", c2], ["concat helper", c3], ["concat-more here", c4], ["concat-more helper", c5], ["concat-onto here", c6], ["concat-onto helper", c7], ["entries here", c8], ["entries helper", c9], ["every here", c10], ["every helper", c11], ["filter here", c12], ["filter helper", c13], ["filter-length here", c14], ["filter-length helper", c15], ["find here", c16], ["find helper", c17], ["findIndex here", c18], ["findIndex helper", c19], ["findLast here", c20], ["findLast helper", c21], ["findLastIndex here", c22], ["findLastIndex helper", c23], ["flat here", c24], ["flat helper", c25], ["flatMap here", c26], ["flatMap helper", c27], ["forEach here", c28], ["forEach helper", c29], ["forEach-method here", c30], ["forEach-method helper", c31], ["includes here", c32], ["includes helper", c33], ["indexOf here", c34], ["indexOf helper", c35], ["join here", c36], ["join helper", c37], ["keys here", c38], ["keys helper", c39], ["map here", c40], ["map helper", c41], ["map-join here", c42], ["map-join helper", c43], ["map-typeof here", c44], ["map-typeof helper", c45], ["map-index here", c46], ["map-index helper", c47], ["reduce here", c48], ["reduce helper", c49], ["reduce-first here", c50], ["reduce-first helper", c51], ["reduceRight here", c52], ["reduceRight helper", c53], ["slice here", c54], ["slice helper", c55], ["slice-1 here", c56], ["slice-1 helper", c57], ["some here", c58], ["some helper", c59], ["toReversed here", c60], ["toReversed helper", c61], ["toSorted here", c62], ["toSorted helper", c63], ["toSpliced here", c64], ["toSpliced helper", c65], ["with here", c66], ["with helper", c67], ["toString here", c68], ["toString helper", c69], ["values here", c70], ["values helper", c71], ["for-of here", c72], ["for-of helper", c73], ["for-in here", c74], ["for-in helper", c75], ["index-loop here", c76], ["index-loop helper", c77], ["spread here", c78], ["spread helper", c79], ["spread-call here", c80], ["spread-call helper", c81], ["destructure here", c82], ["destructure helper", c83], ["Array.from here", c84], ["Array.from helper", c85], ["Array.from-map here", c86], ["Array.from-map helper", c87], ["Array.of here", c88], ["Array.of helper", c89], ["Object.values here", c90], ["Object.values helper", c91], ["Object.entries here", c92], ["Object.entries helper", c93], ["Object.keys here", c94], ["Object.keys helper", c95], ["Object.assign here", c96], ["Object.assign helper", c97], ["object-spread here", c98], ["object-spread helper", c99], ["JSON here", c100], ["JSON helper", c101], ["Set here", c102], ["Set helper", c103], ["Map here", c104], ["Map helper", c105], ["call-map here", c106], ["call-map helper", c107], ["call-slice here", c108], ["call-slice helper", c109], ["apply here", c110], ["apply helper", c111], ["String.raw here", c112], ["String.raw helper", c113], ["structuredClone here", c114], ["structuredClone helper", c115], ["isArray here", c116], ["isArray helper", c117], ["descriptor here", c118], ["descriptor helper", c119], ["push here", c120], ["push helper", c121], ["pop here", c122], ["pop helper", c123], ["shift here", c124], ["shift helper", c125], ["unshift here", c126], ["unshift helper", c127], ["reverse here", c128], ["reverse helper", c129], ["sort here", c130], ["sort helper", c131], ["splice here", c132], ["splice helper", c133], ["fill here", c134], ["fill helper", c135], ["copyWithin here", c136], ["copyWithin helper", c137], ["store here", c138], ["store helper", c139], ["chain here", c140], ["chain helper", c141], ["then-read here", c142], ["then-read helper", c143]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-a-frozen-constant-array-of-numbers.ts": text(
      `// Every method of Array.prototype, and what else reads a list, on a frozen constant array of numbers: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
// @ts-nocheck
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(S: readonly number[]): string { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	3(S: readonly number[]): string { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(): string { const S: any = Object.freeze([1, 2, 3]); const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S: any): string { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(S: readonly number[]): string { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
8(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	9(S: readonly number[]): string { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	10(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	11(S: readonly number[]): string { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	12(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	13(S: readonly number[]): string { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	14(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	15(S: readonly number[]): string { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")
16(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.find(p => p !== undefined); return typeof r + ":" + r	17(S: readonly number[]): string { const r = S.find(p => p !== undefined); return typeof r + ":" + r	18(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	19(S: readonly number[]): string { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	20(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	21(S: readonly number[]): string { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	22(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	23(S: readonly number[]): string { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
24(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	25(S: readonly number[]): string { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	26(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	27(S: readonly number[]): string { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	28(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	29(S: readonly number[]): string { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	30(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	31(S: readonly number[]): string { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t
32(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	33(S: readonly number[]): string { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	34(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	35(S: readonly number[]): string { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	36(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.join("+") + "|" + S.join()	37(S: readonly number[]): string { return S.join("+") + "|" + S.join()	38(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	39(S: readonly number[]): string { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t
40(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S: readonly number[]): string { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.map(p => p + p).join()	43(S: readonly number[]): string { return S.map(p => p + p).join()	44(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.map(p => typeof p).join()	45(S: readonly number[]): string { return S.map(p => typeof p).join()	46(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	47(S: readonly number[]): string { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
48(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.reduce((t, p, i) => t + typeof p + p + i, "")	49(S: readonly number[]): string { return S.reduce((t, p, i) => t + typeof p + p + i, "")	50(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.reduce((a, b) => a); return typeof r + ":" + r	51(S: readonly number[]): string { const r = S.reduce((a, b) => a); return typeof r + ":" + r	52(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.reduceRight((t, p) => t + typeof p + p, "")	53(S: readonly number[]): string { return S.reduceRight((t, p) => t + typeof p + p, "")	54(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	55(S: readonly number[]): string { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
56(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	57(S: readonly number[]): string { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	58(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	59(S: readonly number[]): string { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	60(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(S: readonly number[]): string { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	63(S: readonly number[]): string { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
64(): string { const S: any = Object.freeze([1, 2, 3]); const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	65(S: any): string { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	66(): string { const S: any = Object.freeze([1, 2, 3]); const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	67(S: any): string { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	68(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	69(S: readonly number[]): string { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	70(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	71(S: readonly number[]): string { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
72(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const p of S) t += typeof p + p + ","; return t	73(S: readonly number[]): string { let t = ""; for (const p of S) t += typeof p + p + ","; return t	74(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	75(S: readonly number[]): string { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	76(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	77(S: readonly number[]): string { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	78(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	79(S: readonly number[]): string { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
80(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	81(S: readonly number[]): string { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	82(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	83(S: readonly number[]): string { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	84(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	85(S: readonly number[]): string { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	86(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	87(S: readonly number[]): string { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
88(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	89(S: readonly number[]): string { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	90(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(S: readonly number[]): string { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	93(S: readonly number[]): string { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	94(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	95(S: readonly number[]): string { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
96(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(S: readonly number[]): string { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	99(S: readonly number[]): string { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	100(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return JSON.stringify(S)	101(S: readonly number[]): string { return JSON.stringify(S)	102(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	103(S: readonly number[]): string { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])
104(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	105(S: readonly number[]): string { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	106(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	107(S: readonly number[]): string { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	108(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	109(S: readonly number[]): string { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	110(): string { const S: any = Object.freeze([1, 2, 3]); return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	111(S: any): string { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)
112(): string { const S: any = Object.freeze([1, 2, 3]); return String.raw({ raw: S }, 1, 2)	113(S: any): string { return String.raw({ raw: S }, 1, 2)	114(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	115(S: readonly number[]): string { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	116(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	117(S: readonly number[]): string { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	118(): string { const S: readonly number[] = Object.freeze([1, 2, 3]); const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	119(S: readonly number[]): string { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
120(): string { const S: any = Object.freeze([1, 2, 3]); S.push("x"); return "pushed"	121(S: any): string { S.push("x"); return "pushed"	122(): string { const S: any = Object.freeze([1, 2, 3]); return "popped " + S.pop()	123(S: any): string { return "popped " + S.pop()	124(): string { const S: any = Object.freeze([1, 2, 3]); return "shifted " + S.shift()	125(S: any): string { return "shifted " + S.shift()	126(): string { const S: any = Object.freeze([1, 2, 3]); S.unshift("x"); return "unshifted"	127(S: any): string { S.unshift("x"); return "unshifted"
128(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.reverse())	129(S: any): string { return show(S.reverse())	130(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.sort())	131(S: any): string { return show(S.sort())	132(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.splice(0, 1))	133(S: any): string { return show(S.splice(0, 1))	134(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.fill("f"))	135(S: any): string { return show(S.fill("f"))
136(): string { const S: any = Object.freeze([1, 2, 3]); return show(S.copyWithin(0, 1))	137(S: any): string { return show(S.copyWithin(0, 1))	138(): string { const S: any = Object.freeze([1, 2, 3]); "use strict"; S[0] = "x"; return "stored"	139(S: any): string { "use strict"; S[0] = "x"; return "stored"	140(): string { const S: any = Object.freeze([1, 2, 3]); return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	141(S: any): string { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	142(): string { const S: any = Object.freeze([1, 2, 3]); const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	143(S: any): string { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h) => `
function c${a}; }

function hc${b}; }
function c${8 * n + 1}(): string { return hc${8 * n + 1}(Object.freeze([1, 2, 3])); }

function c${c}; }

function hc${d}; }
function c${8 * n + 3}(): string { return hc${8 * n + 3}(Object.freeze([1, 2, 3])); }

function c${e}; }

function hc${f}; }
function c${8 * n + 5}(): string { return hc${8 * n + 5}(Object.freeze([1, 2, 3])); }

function c${g}; }

function hc${h}; }
function c${8 * n + 7}(): string { return hc${8 * n + 7}(Object.freeze([1, 2, 3])); }`,
      ],
      `const cases: [string, () => string][] = [["at here", c0], ["at helper", c1], ["concat here", c2], ["concat helper", c3], ["concat-more here", c4], ["concat-more helper", c5], ["concat-onto here", c6], ["concat-onto helper", c7], ["entries here", c8], ["entries helper", c9], ["every here", c10], ["every helper", c11], ["filter here", c12], ["filter helper", c13], ["filter-length here", c14], ["filter-length helper", c15], ["find here", c16], ["find helper", c17], ["findIndex here", c18], ["findIndex helper", c19], ["findLast here", c20], ["findLast helper", c21], ["findLastIndex here", c22], ["findLastIndex helper", c23], ["flat here", c24], ["flat helper", c25], ["flatMap here", c26], ["flatMap helper", c27], ["forEach here", c28], ["forEach helper", c29], ["forEach-method here", c30], ["forEach-method helper", c31], ["includes here", c32], ["includes helper", c33], ["indexOf here", c34], ["indexOf helper", c35], ["join here", c36], ["join helper", c37], ["keys here", c38], ["keys helper", c39], ["map here", c40], ["map helper", c41], ["map-join here", c42], ["map-join helper", c43], ["map-typeof here", c44], ["map-typeof helper", c45], ["map-index here", c46], ["map-index helper", c47], ["reduce here", c48], ["reduce helper", c49], ["reduce-first here", c50], ["reduce-first helper", c51], ["reduceRight here", c52], ["reduceRight helper", c53], ["slice here", c54], ["slice helper", c55], ["slice-1 here", c56], ["slice-1 helper", c57], ["some here", c58], ["some helper", c59], ["toReversed here", c60], ["toReversed helper", c61], ["toSorted here", c62], ["toSorted helper", c63], ["toSpliced here", c64], ["toSpliced helper", c65], ["with here", c66], ["with helper", c67], ["toString here", c68], ["toString helper", c69], ["values here", c70], ["values helper", c71], ["for-of here", c72], ["for-of helper", c73], ["for-in here", c74], ["for-in helper", c75], ["index-loop here", c76], ["index-loop helper", c77], ["spread here", c78], ["spread helper", c79], ["spread-call here", c80], ["spread-call helper", c81], ["destructure here", c82], ["destructure helper", c83], ["Array.from here", c84], ["Array.from helper", c85], ["Array.from-map here", c86], ["Array.from-map helper", c87], ["Array.of here", c88], ["Array.of helper", c89], ["Object.values here", c90], ["Object.values helper", c91], ["Object.entries here", c92], ["Object.entries helper", c93], ["Object.keys here", c94], ["Object.keys helper", c95], ["Object.assign here", c96], ["Object.assign helper", c97], ["object-spread here", c98], ["object-spread helper", c99], ["JSON here", c100], ["JSON helper", c101], ["Set here", c102], ["Set helper", c103], ["Map here", c104], ["Map helper", c105], ["call-map here", c106], ["call-map helper", c107], ["call-slice here", c108], ["call-slice helper", c109], ["apply here", c110], ["apply helper", c111], ["String.raw here", c112], ["String.raw helper", c113], ["structuredClone here", c114], ["structuredClone helper", c115], ["isArray here", c116], ["isArray helper", c117], ["descriptor here", c118], ["descriptor helper", c119], ["push here", c120], ["push helper", c121], ["pop here", c122], ["pop helper", c123], ["shift here", c124], ["shift helper", c125], ["unshift here", c126], ["unshift helper", c127], ["reverse here", c128], ["reverse helper", c129], ["sort here", c130], ["sort helper", c131], ["splice here", c132], ["splice helper", c133], ["fill here", c134], ["fill helper", c135], ["copyWithin here", c136], ["copyWithin helper", c137], ["store here", c138], ["store helper", c139], ["chain here", c140], ["chain helper", c141], ["then-read here", c142], ["then-read helper", c143]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e as any).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-a-frozen-constant-array-of-strings.js": text(
      `// Every method of Array.prototype, and what else reads a list, on a frozen constant array of strings: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
function show(v) {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0() { const S = Object.freeze(["a", "b", "c"]); const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(S) { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2() { const S = Object.freeze(["a", "b", "c"]); const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	3(S) { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4() { const S = Object.freeze(["a", "b", "c"]); const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S) { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6() { const S = Object.freeze(["a", "b", "c"]); const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(S) { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
8() { const S = Object.freeze(["a", "b", "c"]); let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	9(S) { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	10() { const S = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	11(S) { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	12() { const S = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	13(S) { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	14() { const S = Object.freeze(["a", "b", "c"]); const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	15(S) { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")
16() { const S = Object.freeze(["a", "b", "c"]); const r = S.find(p => p !== undefined); return typeof r + ":" + r	17(S) { const r = S.find(p => p !== undefined); return typeof r + ":" + r	18() { const S = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	19(S) { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	20() { const S = Object.freeze(["a", "b", "c"]); const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	21(S) { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	22() { const S = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	23(S) { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
24() { const S = Object.freeze(["a", "b", "c"]); const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	25(S) { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	26() { const S = Object.freeze(["a", "b", "c"]); const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	27(S) { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	28() { const S = Object.freeze(["a", "b", "c"]); let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	29(S) { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	30() { const S = Object.freeze(["a", "b", "c"]); let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	31(S) { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t
32() { const S = Object.freeze(["a", "b", "c"]); return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	33(S) { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	34() { const S = Object.freeze(["a", "b", "c"]); return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	35(S) { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	36() { const S = Object.freeze(["a", "b", "c"]); return S.join("+") + "|" + S.join()	37(S) { return S.join("+") + "|" + S.join()	38() { const S = Object.freeze(["a", "b", "c"]); let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	39(S) { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t
40() { const S = Object.freeze(["a", "b", "c"]); const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S) { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42() { const S = Object.freeze(["a", "b", "c"]); return S.map(p => p + p).join()	43(S) { return S.map(p => p + p).join()	44() { const S = Object.freeze(["a", "b", "c"]); return S.map(p => typeof p).join()	45(S) { return S.map(p => typeof p).join()	46() { const S = Object.freeze(["a", "b", "c"]); const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	47(S) { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
48() { const S = Object.freeze(["a", "b", "c"]); return S.reduce((t, p, i) => t + typeof p + p + i, "")	49(S) { return S.reduce((t, p, i) => t + typeof p + p + i, "")	50() { const S = Object.freeze(["a", "b", "c"]); const r = S.reduce((a, b) => a); return typeof r + ":" + r	51(S) { const r = S.reduce((a, b) => a); return typeof r + ":" + r	52() { const S = Object.freeze(["a", "b", "c"]); return S.reduceRight((t, p) => t + typeof p + p, "")	53(S) { return S.reduceRight((t, p) => t + typeof p + p, "")	54() { const S = Object.freeze(["a", "b", "c"]); const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	55(S) { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
56() { const S = Object.freeze(["a", "b", "c"]); const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	57(S) { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	58() { const S = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	59(S) { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	60() { const S = Object.freeze(["a", "b", "c"]); const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(S) { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62() { const S = Object.freeze(["a", "b", "c"]); const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	63(S) { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
64() { const S = Object.freeze(["a", "b", "c"]); const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	65(S) { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	66() { const S = Object.freeze(["a", "b", "c"]); const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	67(S) { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	68() { const S = Object.freeze(["a", "b", "c"]); return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	69(S) { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	70() { const S = Object.freeze(["a", "b", "c"]); let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	71(S) { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
72() { const S = Object.freeze(["a", "b", "c"]); let t = ""; for (const p of S) t += typeof p + p + ","; return t	73(S) { let t = ""; for (const p of S) t += typeof p + p + ","; return t	74() { const S = Object.freeze(["a", "b", "c"]); let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	75(S) { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	76() { const S = Object.freeze(["a", "b", "c"]); let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	77(S) { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	78() { const S = Object.freeze(["a", "b", "c"]); const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	79(S) { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
80() { const S = Object.freeze(["a", "b", "c"]); const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	81(S) { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	82() { const S = Object.freeze(["a", "b", "c"]); const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	83(S) { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	84() { const S = Object.freeze(["a", "b", "c"]); const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	85(S) { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	86() { const S = Object.freeze(["a", "b", "c"]); const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	87(S) { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
88() { const S = Object.freeze(["a", "b", "c"]); const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	89(S) { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	90() { const S = Object.freeze(["a", "b", "c"]); const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(S) { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92() { const S = Object.freeze(["a", "b", "c"]); const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	93(S) { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	94() { const S = Object.freeze(["a", "b", "c"]); return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	95(S) { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
96() { const S = Object.freeze(["a", "b", "c"]); const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(S) { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98() { const S = Object.freeze(["a", "b", "c"]); const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	99(S) { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	100() { const S = Object.freeze(["a", "b", "c"]); return JSON.stringify(S)	101(S) { return JSON.stringify(S)	102() { const S = Object.freeze(["a", "b", "c"]); const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	103(S) { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])
104() { const S = Object.freeze(["a", "b", "c"]); const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	105(S) { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	106() { const S = Object.freeze(["a", "b", "c"]); const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	107(S) { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	108() { const S = Object.freeze(["a", "b", "c"]); const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	109(S) { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	110() { const S = Object.freeze(["a", "b", "c"]); return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	111(S) { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)
112() { const S = Object.freeze(["a", "b", "c"]); return String.raw({ raw: S }, 1, 2)	113(S) { return String.raw({ raw: S }, 1, 2)	114() { const S = Object.freeze(["a", "b", "c"]); const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	115(S) { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	116() { const S = Object.freeze(["a", "b", "c"]); return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	117(S) { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	118() { const S = Object.freeze(["a", "b", "c"]); const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	119(S) { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
120() { const S = Object.freeze(["a", "b", "c"]); S.push("x"); return "pushed"	121(S) { S.push("x"); return "pushed"	122() { const S = Object.freeze(["a", "b", "c"]); return "popped " + S.pop()	123(S) { return "popped " + S.pop()	124() { const S = Object.freeze(["a", "b", "c"]); return "shifted " + S.shift()	125(S) { return "shifted " + S.shift()	126() { const S = Object.freeze(["a", "b", "c"]); S.unshift("x"); return "unshifted"	127(S) { S.unshift("x"); return "unshifted"
128() { const S = Object.freeze(["a", "b", "c"]); return show(S.reverse())	129(S) { return show(S.reverse())	130() { const S = Object.freeze(["a", "b", "c"]); return show(S.sort())	131(S) { return show(S.sort())	132() { const S = Object.freeze(["a", "b", "c"]); return show(S.splice(0, 1))	133(S) { return show(S.splice(0, 1))	134() { const S = Object.freeze(["a", "b", "c"]); return show(S.fill("f"))	135(S) { return show(S.fill("f"))
136() { const S = Object.freeze(["a", "b", "c"]); return show(S.copyWithin(0, 1))	137(S) { return show(S.copyWithin(0, 1))	138() { const S = Object.freeze(["a", "b", "c"]); "use strict"; S[0] = "x"; return "stored"	139(S) { "use strict"; S[0] = "x"; return "stored"	140() { const S = Object.freeze(["a", "b", "c"]); return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	141(S) { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	142() { const S = Object.freeze(["a", "b", "c"]); const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	143(S) { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h) => `
function c${a}; }

function hc${b}; }
function c${8 * n + 1}() { return hc${8 * n + 1}(Object.freeze(["a", "b", "c"])); }

function c${c}; }

function hc${d}; }
function c${8 * n + 3}() { return hc${8 * n + 3}(Object.freeze(["a", "b", "c"])); }

function c${e}; }

function hc${f}; }
function c${8 * n + 5}() { return hc${8 * n + 5}(Object.freeze(["a", "b", "c"])); }

function c${g}; }

function hc${h}; }
function c${8 * n + 7}() { return hc${8 * n + 7}(Object.freeze(["a", "b", "c"])); }`,
      ],
      `const cases = [["at here", c0], ["at helper", c1], ["concat here", c2], ["concat helper", c3], ["concat-more here", c4], ["concat-more helper", c5], ["concat-onto here", c6], ["concat-onto helper", c7], ["entries here", c8], ["entries helper", c9], ["every here", c10], ["every helper", c11], ["filter here", c12], ["filter helper", c13], ["filter-length here", c14], ["filter-length helper", c15], ["find here", c16], ["find helper", c17], ["findIndex here", c18], ["findIndex helper", c19], ["findLast here", c20], ["findLast helper", c21], ["findLastIndex here", c22], ["findLastIndex helper", c23], ["flat here", c24], ["flat helper", c25], ["flatMap here", c26], ["flatMap helper", c27], ["forEach here", c28], ["forEach helper", c29], ["forEach-method here", c30], ["forEach-method helper", c31], ["includes here", c32], ["includes helper", c33], ["indexOf here", c34], ["indexOf helper", c35], ["join here", c36], ["join helper", c37], ["keys here", c38], ["keys helper", c39], ["map here", c40], ["map helper", c41], ["map-join here", c42], ["map-join helper", c43], ["map-typeof here", c44], ["map-typeof helper", c45], ["map-index here", c46], ["map-index helper", c47], ["reduce here", c48], ["reduce helper", c49], ["reduce-first here", c50], ["reduce-first helper", c51], ["reduceRight here", c52], ["reduceRight helper", c53], ["slice here", c54], ["slice helper", c55], ["slice-1 here", c56], ["slice-1 helper", c57], ["some here", c58], ["some helper", c59], ["toReversed here", c60], ["toReversed helper", c61], ["toSorted here", c62], ["toSorted helper", c63], ["toSpliced here", c64], ["toSpliced helper", c65], ["with here", c66], ["with helper", c67], ["toString here", c68], ["toString helper", c69], ["values here", c70], ["values helper", c71], ["for-of here", c72], ["for-of helper", c73], ["for-in here", c74], ["for-in helper", c75], ["index-loop here", c76], ["index-loop helper", c77], ["spread here", c78], ["spread helper", c79], ["spread-call here", c80], ["spread-call helper", c81], ["destructure here", c82], ["destructure helper", c83], ["Array.from here", c84], ["Array.from helper", c85], ["Array.from-map here", c86], ["Array.from-map helper", c87], ["Array.of here", c88], ["Array.of helper", c89], ["Object.values here", c90], ["Object.values helper", c91], ["Object.entries here", c92], ["Object.entries helper", c93], ["Object.keys here", c94], ["Object.keys helper", c95], ["Object.assign here", c96], ["Object.assign helper", c97], ["object-spread here", c98], ["object-spread helper", c99], ["JSON here", c100], ["JSON helper", c101], ["Set here", c102], ["Set helper", c103], ["Map here", c104], ["Map helper", c105], ["call-map here", c106], ["call-map helper", c107], ["call-slice here", c108], ["call-slice helper", c109], ["apply here", c110], ["apply helper", c111], ["String.raw here", c112], ["String.raw helper", c113], ["structuredClone here", c114], ["structuredClone helper", c115], ["isArray here", c116], ["isArray helper", c117], ["descriptor here", c118], ["descriptor helper", c119], ["push here", c120], ["push helper", c121], ["pop here", c122], ["pop helper", c123], ["shift here", c124], ["shift helper", c125], ["unshift here", c126], ["unshift helper", c127], ["reverse here", c128], ["reverse helper", c129], ["sort here", c130], ["sort helper", c131], ["splice here", c132], ["splice helper", c133], ["fill here", c134], ["fill helper", c135], ["copyWithin here", c136], ["copyWithin helper", c137], ["store here", c138], ["store helper", c139], ["chain here", c140], ["chain helper", c141], ["then-read here", c142], ["then-read helper", c143]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-a-frozen-constant-array-of-strings.ts": text(
      `// Every method of Array.prototype, and what else reads a list, on a frozen constant array of strings: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
// @ts-nocheck
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(S: readonly string[]): string { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	3(S: readonly string[]): string { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(): string { const S: any = Object.freeze(["a", "b", "c"]); const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S: any): string { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(S: readonly string[]): string { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
8(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	9(S: readonly string[]): string { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	10(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	11(S: readonly string[]): string { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	12(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	13(S: readonly string[]): string { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	14(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	15(S: readonly string[]): string { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")
16(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.find(p => p !== undefined); return typeof r + ":" + r	17(S: readonly string[]): string { const r = S.find(p => p !== undefined); return typeof r + ":" + r	18(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	19(S: readonly string[]): string { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	20(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	21(S: readonly string[]): string { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	22(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	23(S: readonly string[]): string { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
24(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	25(S: readonly string[]): string { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	26(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	27(S: readonly string[]): string { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	28(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	29(S: readonly string[]): string { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	30(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	31(S: readonly string[]): string { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t
32(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	33(S: readonly string[]): string { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	34(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	35(S: readonly string[]): string { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	36(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return S.join("+") + "|" + S.join()	37(S: readonly string[]): string { return S.join("+") + "|" + S.join()	38(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	39(S: readonly string[]): string { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t
40(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S: readonly string[]): string { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return S.map(p => p + p).join()	43(S: readonly string[]): string { return S.map(p => p + p).join()	44(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return S.map(p => typeof p).join()	45(S: readonly string[]): string { return S.map(p => typeof p).join()	46(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	47(S: readonly string[]): string { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
48(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return S.reduce((t, p, i) => t + typeof p + p + i, "")	49(S: readonly string[]): string { return S.reduce((t, p, i) => t + typeof p + p + i, "")	50(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.reduce((a, b) => a); return typeof r + ":" + r	51(S: readonly string[]): string { const r = S.reduce((a, b) => a); return typeof r + ":" + r	52(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return S.reduceRight((t, p) => t + typeof p + p, "")	53(S: readonly string[]): string { return S.reduceRight((t, p) => t + typeof p + p, "")	54(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	55(S: readonly string[]): string { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
56(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	57(S: readonly string[]): string { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	58(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	59(S: readonly string[]): string { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	60(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(S: readonly string[]): string { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	63(S: readonly string[]): string { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
64(): string { const S: any = Object.freeze(["a", "b", "c"]); const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	65(S: any): string { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	66(): string { const S: any = Object.freeze(["a", "b", "c"]); const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	67(S: any): string { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	68(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	69(S: readonly string[]): string { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	70(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	71(S: readonly string[]): string { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
72(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; for (const p of S) t += typeof p + p + ","; return t	73(S: readonly string[]): string { let t = ""; for (const p of S) t += typeof p + p + ","; return t	74(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	75(S: readonly string[]): string { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	76(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	77(S: readonly string[]): string { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	78(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	79(S: readonly string[]): string { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
80(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	81(S: readonly string[]): string { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	82(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	83(S: readonly string[]): string { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	84(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	85(S: readonly string[]): string { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	86(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	87(S: readonly string[]): string { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
88(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	89(S: readonly string[]): string { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	90(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(S: readonly string[]): string { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	93(S: readonly string[]): string { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	94(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	95(S: readonly string[]): string { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
96(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(S: readonly string[]): string { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	99(S: readonly string[]): string { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	100(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return JSON.stringify(S)	101(S: readonly string[]): string { return JSON.stringify(S)	102(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	103(S: readonly string[]): string { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])
104(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	105(S: readonly string[]): string { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	106(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	107(S: readonly string[]): string { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	108(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	109(S: readonly string[]): string { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	110(): string { const S: any = Object.freeze(["a", "b", "c"]); return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	111(S: any): string { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)
112(): string { const S: any = Object.freeze(["a", "b", "c"]); return String.raw({ raw: S }, 1, 2)	113(S: any): string { return String.raw({ raw: S }, 1, 2)	114(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	115(S: readonly string[]): string { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	116(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	117(S: readonly string[]): string { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	118(): string { const S: readonly string[] = Object.freeze(["a", "b", "c"]); const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	119(S: readonly string[]): string { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
120(): string { const S: any = Object.freeze(["a", "b", "c"]); S.push("x"); return "pushed"	121(S: any): string { S.push("x"); return "pushed"	122(): string { const S: any = Object.freeze(["a", "b", "c"]); return "popped " + S.pop()	123(S: any): string { return "popped " + S.pop()	124(): string { const S: any = Object.freeze(["a", "b", "c"]); return "shifted " + S.shift()	125(S: any): string { return "shifted " + S.shift()	126(): string { const S: any = Object.freeze(["a", "b", "c"]); S.unshift("x"); return "unshifted"	127(S: any): string { S.unshift("x"); return "unshifted"
128(): string { const S: any = Object.freeze(["a", "b", "c"]); return show(S.reverse())	129(S: any): string { return show(S.reverse())	130(): string { const S: any = Object.freeze(["a", "b", "c"]); return show(S.sort())	131(S: any): string { return show(S.sort())	132(): string { const S: any = Object.freeze(["a", "b", "c"]); return show(S.splice(0, 1))	133(S: any): string { return show(S.splice(0, 1))	134(): string { const S: any = Object.freeze(["a", "b", "c"]); return show(S.fill("f"))	135(S: any): string { return show(S.fill("f"))
136(): string { const S: any = Object.freeze(["a", "b", "c"]); return show(S.copyWithin(0, 1))	137(S: any): string { return show(S.copyWithin(0, 1))	138(): string { const S: any = Object.freeze(["a", "b", "c"]); "use strict"; S[0] = "x"; return "stored"	139(S: any): string { "use strict"; S[0] = "x"; return "stored"	140(): string { const S: any = Object.freeze(["a", "b", "c"]); return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	141(S: any): string { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	142(): string { const S: any = Object.freeze(["a", "b", "c"]); const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	143(S: any): string { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h) => `
function c${a}; }

function hc${b}; }
function c${8 * n + 1}(): string { return hc${8 * n + 1}(Object.freeze(["a", "b", "c"])); }

function c${c}; }

function hc${d}; }
function c${8 * n + 3}(): string { return hc${8 * n + 3}(Object.freeze(["a", "b", "c"])); }

function c${e}; }

function hc${f}; }
function c${8 * n + 5}(): string { return hc${8 * n + 5}(Object.freeze(["a", "b", "c"])); }

function c${g}; }

function hc${h}; }
function c${8 * n + 7}(): string { return hc${8 * n + 7}(Object.freeze(["a", "b", "c"])); }`,
      ],
      `const cases: [string, () => string][] = [["at here", c0], ["at helper", c1], ["concat here", c2], ["concat helper", c3], ["concat-more here", c4], ["concat-more helper", c5], ["concat-onto here", c6], ["concat-onto helper", c7], ["entries here", c8], ["entries helper", c9], ["every here", c10], ["every helper", c11], ["filter here", c12], ["filter helper", c13], ["filter-length here", c14], ["filter-length helper", c15], ["find here", c16], ["find helper", c17], ["findIndex here", c18], ["findIndex helper", c19], ["findLast here", c20], ["findLast helper", c21], ["findLastIndex here", c22], ["findLastIndex helper", c23], ["flat here", c24], ["flat helper", c25], ["flatMap here", c26], ["flatMap helper", c27], ["forEach here", c28], ["forEach helper", c29], ["forEach-method here", c30], ["forEach-method helper", c31], ["includes here", c32], ["includes helper", c33], ["indexOf here", c34], ["indexOf helper", c35], ["join here", c36], ["join helper", c37], ["keys here", c38], ["keys helper", c39], ["map here", c40], ["map helper", c41], ["map-join here", c42], ["map-join helper", c43], ["map-typeof here", c44], ["map-typeof helper", c45], ["map-index here", c46], ["map-index helper", c47], ["reduce here", c48], ["reduce helper", c49], ["reduce-first here", c50], ["reduce-first helper", c51], ["reduceRight here", c52], ["reduceRight helper", c53], ["slice here", c54], ["slice helper", c55], ["slice-1 here", c56], ["slice-1 helper", c57], ["some here", c58], ["some helper", c59], ["toReversed here", c60], ["toReversed helper", c61], ["toSorted here", c62], ["toSorted helper", c63], ["toSpliced here", c64], ["toSpliced helper", c65], ["with here", c66], ["with helper", c67], ["toString here", c68], ["toString helper", c69], ["values here", c70], ["values helper", c71], ["for-of here", c72], ["for-of helper", c73], ["for-in here", c74], ["for-in helper", c75], ["index-loop here", c76], ["index-loop helper", c77], ["spread here", c78], ["spread helper", c79], ["spread-call here", c80], ["spread-call helper", c81], ["destructure here", c82], ["destructure helper", c83], ["Array.from here", c84], ["Array.from helper", c85], ["Array.from-map here", c86], ["Array.from-map helper", c87], ["Array.of here", c88], ["Array.of helper", c89], ["Object.values here", c90], ["Object.values helper", c91], ["Object.entries here", c92], ["Object.entries helper", c93], ["Object.keys here", c94], ["Object.keys helper", c95], ["Object.assign here", c96], ["Object.assign helper", c97], ["object-spread here", c98], ["object-spread helper", c99], ["JSON here", c100], ["JSON helper", c101], ["Set here", c102], ["Set helper", c103], ["Map here", c104], ["Map helper", c105], ["call-map here", c106], ["call-map helper", c107], ["call-slice here", c108], ["call-slice helper", c109], ["apply here", c110], ["apply helper", c111], ["String.raw here", c112], ["String.raw helper", c113], ["structuredClone here", c114], ["structuredClone helper", c115], ["isArray here", c116], ["isArray helper", c117], ["descriptor here", c118], ["descriptor helper", c119], ["push here", c120], ["push helper", c121], ["pop here", c122], ["pop helper", c123], ["shift here", c124], ["shift helper", c125], ["unshift here", c126], ["unshift helper", c127], ["reverse here", c128], ["reverse helper", c129], ["sort here", c130], ["sort helper", c131], ["splice here", c132], ["splice helper", c133], ["fill here", c134], ["fill helper", c135], ["copyWithin here", c136], ["copyWithin helper", c137], ["store here", c138], ["store helper", c139], ["chain here", c140], ["chain helper", c141], ["then-read here", c142], ["then-read helper", c143]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e as any).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-the-raw-strings-of-a-tagged-template.js": text(
      `// Every method of Array.prototype, and what else reads a list, on the raw strings of a tagged template: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
function show(v) {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0() { const S = tagc0\`a\${1}b\${2}c\`.raw; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(strings, ...rest) { const S = strings.raw; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(S) { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	3() { const S = tagc3\`a\${1}b\${2}c\`.raw; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(strings, ...rest) { const S = strings.raw; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S) { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6() { const S = tagc6\`a\${1}b\${2}c\`.raw; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(strings, ...rest) { const S = strings.raw; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	8(S) { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
9() { const S = tagc9\`a\${1}b\${2}c\`.raw; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	10(strings, ...rest) { const S = strings.raw; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	11(S) { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	12() { const S = tagc12\`a\${1}b\${2}c\`.raw; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	13(strings, ...rest) { const S = strings.raw; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	14(S) { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	15() { const S = tagc15\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	16(strings, ...rest) { const S = strings.raw; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	17(S) { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t
18() { const S = tagc18\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	19(strings, ...rest) { const S = strings.raw; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	20(S) { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	21() { const S = tagc21\`a\${1}b\${2}c\`.raw; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	22(strings, ...rest) { const S = strings.raw; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	23(S) { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	24() { const S = tagc24\`a\${1}b\${2}c\`.raw; const r = S.find(p => p !== undefined); return typeof r + ":" + r	25(strings, ...rest) { const S = strings.raw; const r = S.find(p => p !== undefined); return typeof r + ":" + r	26(S) { const r = S.find(p => p !== undefined); return typeof r + ":" + r
27() { const S = tagc27\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	28(strings, ...rest) { const S = strings.raw; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	29(S) { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	30() { const S = tagc30\`a\${1}b\${2}c\`.raw; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	31(strings, ...rest) { const S = strings.raw; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	32(S) { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	33() { const S = tagc33\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	34(strings, ...rest) { const S = strings.raw; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	35(S) { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
36() { const S = tagc36\`a\${1}b\${2}c\`.raw; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	37(strings, ...rest) { const S = strings.raw; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	38(S) { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	39() { const S = tagc39\`a\${1}b\${2}c\`.raw; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	40(strings, ...rest) { const S = strings.raw; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S) { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42() { const S = tagc42\`a\${1}b\${2}c\`.raw; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	43(strings, ...rest) { const S = strings.raw; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	44(S) { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t
45() { const S = tagc45\`a\${1}b\${2}c\`.raw; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	46(strings, ...rest) { const S = strings.raw; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	47(S) { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	48() { const S = tagc48\`a\${1}b\${2}c\`.raw; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	49(strings, ...rest) { const S = strings.raw; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	50(S) { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	51() { const S = tagc51\`a\${1}b\${2}c\`.raw; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	52(strings, ...rest) { const S = strings.raw; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	53(S) { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])
54() { const S = tagc54\`a\${1}b\${2}c\`.raw; return S.join("+") + "|" + S.join()	55(strings, ...rest) { const S = strings.raw; return S.join("+") + "|" + S.join()	56(S) { return S.join("+") + "|" + S.join()	57() { const S = tagc57\`a\${1}b\${2}c\`.raw; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	58(strings, ...rest) { const S = strings.raw; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	59(S) { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	60() { const S = tagc60\`a\${1}b\${2}c\`.raw; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(strings, ...rest) { const S = strings.raw; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(S) { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
63() { const S = tagc63\`a\${1}b\${2}c\`.raw; return S.map(p => p + p).join()	64(strings, ...rest) { const S = strings.raw; return S.map(p => p + p).join()	65(S) { return S.map(p => p + p).join()	66() { const S = tagc66\`a\${1}b\${2}c\`.raw; return S.map(p => typeof p).join()	67(strings, ...rest) { const S = strings.raw; return S.map(p => typeof p).join()	68(S) { return S.map(p => typeof p).join()	69() { const S = tagc69\`a\${1}b\${2}c\`.raw; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	70(strings, ...rest) { const S = strings.raw; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	71(S) { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
72() { const S = tagc72\`a\${1}b\${2}c\`.raw; return S.reduce((t, p, i) => t + typeof p + p + i, "")	73(strings, ...rest) { const S = strings.raw; return S.reduce((t, p, i) => t + typeof p + p + i, "")	74(S) { return S.reduce((t, p, i) => t + typeof p + p + i, "")	75() { const S = tagc75\`a\${1}b\${2}c\`.raw; const r = S.reduce((a, b) => a); return typeof r + ":" + r	76(strings, ...rest) { const S = strings.raw; const r = S.reduce((a, b) => a); return typeof r + ":" + r	77(S) { const r = S.reduce((a, b) => a); return typeof r + ":" + r	78() { const S = tagc78\`a\${1}b\${2}c\`.raw; return S.reduceRight((t, p) => t + typeof p + p, "")	79(strings, ...rest) { const S = strings.raw; return S.reduceRight((t, p) => t + typeof p + p, "")	80(S) { return S.reduceRight((t, p) => t + typeof p + p, "")
81() { const S = tagc81\`a\${1}b\${2}c\`.raw; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	82(strings, ...rest) { const S = strings.raw; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	83(S) { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	84() { const S = tagc84\`a\${1}b\${2}c\`.raw; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	85(strings, ...rest) { const S = strings.raw; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	86(S) { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	87() { const S = tagc87\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	88(strings, ...rest) { const S = strings.raw; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	89(S) { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t
90() { const S = tagc90\`a\${1}b\${2}c\`.raw; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(strings, ...rest) { const S = strings.raw; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(S) { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	93() { const S = tagc93\`a\${1}b\${2}c\`.raw; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	94(strings, ...rest) { const S = strings.raw; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	95(S) { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	96() { const S = tagc96\`a\${1}b\${2}c\`.raw; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(strings, ...rest) { const S = strings.raw; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(S) { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
99() { const S = tagc99\`a\${1}b\${2}c\`.raw; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	100(strings, ...rest) { const S = strings.raw; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	101(S) { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	102() { const S = tagc102\`a\${1}b\${2}c\`.raw; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	103(strings, ...rest) { const S = strings.raw; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	104(S) { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	105() { const S = tagc105\`a\${1}b\${2}c\`.raw; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	106(strings, ...rest) { const S = strings.raw; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	107(S) { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
108() { const S = tagc108\`a\${1}b\${2}c\`.raw; let t = ""; for (const p of S) t += typeof p + p + ","; return t	109(strings, ...rest) { const S = strings.raw; let t = ""; for (const p of S) t += typeof p + p + ","; return t	110(S) { let t = ""; for (const p of S) t += typeof p + p + ","; return t	111() { const S = tagc111\`a\${1}b\${2}c\`.raw; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	112(strings, ...rest) { const S = strings.raw; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	113(S) { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	114() { const S = tagc114\`a\${1}b\${2}c\`.raw; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	115(strings, ...rest) { const S = strings.raw; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	116(S) { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t
117() { const S = tagc117\`a\${1}b\${2}c\`.raw; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	118(strings, ...rest) { const S = strings.raw; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	119(S) { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	120() { const S = tagc120\`a\${1}b\${2}c\`.raw; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	121(strings, ...rest) { const S = strings.raw; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	122(S) { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	123() { const S = tagc123\`a\${1}b\${2}c\`.raw; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	124(strings, ...rest) { const S = strings.raw; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	125(S) { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)
126() { const S = tagc126\`a\${1}b\${2}c\`.raw; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	127(strings, ...rest) { const S = strings.raw; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	128(S) { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	129() { const S = tagc129\`a\${1}b\${2}c\`.raw; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	130(strings, ...rest) { const S = strings.raw; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	131(S) { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	132() { const S = tagc132\`a\${1}b\${2}c\`.raw; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	133(strings, ...rest) { const S = strings.raw; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	134(S) { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
135() { const S = tagc135\`a\${1}b\${2}c\`.raw; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	136(strings, ...rest) { const S = strings.raw; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	137(S) { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	138() { const S = tagc138\`a\${1}b\${2}c\`.raw; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	139(strings, ...rest) { const S = strings.raw; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	140(S) { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	141() { const S = tagc141\`a\${1}b\${2}c\`.raw; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	142(strings, ...rest) { const S = strings.raw; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	143(S) { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
144() { const S = tagc144\`a\${1}b\${2}c\`.raw; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	145(strings, ...rest) { const S = strings.raw; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	146(S) { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	147() { const S = tagc147\`a\${1}b\${2}c\`.raw; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	148(strings, ...rest) { const S = strings.raw; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	149(S) { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	150() { const S = tagc150\`a\${1}b\${2}c\`.raw; return JSON.stringify(S)	151(strings, ...rest) { const S = strings.raw; return JSON.stringify(S)	152(S) { return JSON.stringify(S)
153() { const S = tagc153\`a\${1}b\${2}c\`.raw; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	154(strings, ...rest) { const S = strings.raw; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	155(S) { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	156() { const S = tagc156\`a\${1}b\${2}c\`.raw; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	157(strings, ...rest) { const S = strings.raw; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	158(S) { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	159() { const S = tagc159\`a\${1}b\${2}c\`.raw; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	160(strings, ...rest) { const S = strings.raw; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	161(S) { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
162() { const S = tagc162\`a\${1}b\${2}c\`.raw; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	163(strings, ...rest) { const S = strings.raw; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	164(S) { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	165() { const S = tagc165\`a\${1}b\${2}c\`.raw; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	166(strings, ...rest) { const S = strings.raw; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	167(S) { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	168() { const S = tagc168\`a\${1}b\${2}c\`.raw; return String.raw({ raw: S }, 1, 2)	169(strings, ...rest) { const S = strings.raw; return String.raw({ raw: S }, 1, 2)	170(S) { return String.raw({ raw: S }, 1, 2)
171() { const S = tagc171\`a\${1}b\${2}c\`.raw; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	172(strings, ...rest) { const S = strings.raw; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	173(S) { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	174() { const S = tagc174\`a\${1}b\${2}c\`.raw; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	175(strings, ...rest) { const S = strings.raw; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	176(S) { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	177() { const S = tagc177\`a\${1}b\${2}c\`.raw; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	178(strings, ...rest) { const S = strings.raw; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	179(S) { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
180() { const S = tagc180\`a\${1}b\${2}c\`.raw; S.push("x"); return "pushed"	181(strings, ...rest) { const S = strings.raw; S.push("x"); return "pushed"	182(S) { S.push("x"); return "pushed"	183() { const S = tagc183\`a\${1}b\${2}c\`.raw; return "popped " + S.pop()	184(strings, ...rest) { const S = strings.raw; return "popped " + S.pop()	185(S) { return "popped " + S.pop()	186() { const S = tagc186\`a\${1}b\${2}c\`.raw; return "shifted " + S.shift()	187(strings, ...rest) { const S = strings.raw; return "shifted " + S.shift()	188(S) { return "shifted " + S.shift()
189() { const S = tagc189\`a\${1}b\${2}c\`.raw; S.unshift("x"); return "unshifted"	190(strings, ...rest) { const S = strings.raw; S.unshift("x"); return "unshifted"	191(S) { S.unshift("x"); return "unshifted"	192() { const S = tagc192\`a\${1}b\${2}c\`.raw; return show(S.reverse())	193(strings, ...rest) { const S = strings.raw; return show(S.reverse())	194(S) { return show(S.reverse())	195() { const S = tagc195\`a\${1}b\${2}c\`.raw; return show(S.sort())	196(strings, ...rest) { const S = strings.raw; return show(S.sort())	197(S) { return show(S.sort())
198() { const S = tagc198\`a\${1}b\${2}c\`.raw; return show(S.splice(0, 1))	199(strings, ...rest) { const S = strings.raw; return show(S.splice(0, 1))	200(S) { return show(S.splice(0, 1))	201() { const S = tagc201\`a\${1}b\${2}c\`.raw; return show(S.fill("f"))	202(strings, ...rest) { const S = strings.raw; return show(S.fill("f"))	203(S) { return show(S.fill("f"))	204() { const S = tagc204\`a\${1}b\${2}c\`.raw; return show(S.copyWithin(0, 1))	205(strings, ...rest) { const S = strings.raw; return show(S.copyWithin(0, 1))	206(S) { return show(S.copyWithin(0, 1))
207() { const S = tagc207\`a\${1}b\${2}c\`.raw; "use strict"; S[0] = "x"; return "stored"	208(strings, ...rest) { const S = strings.raw; "use strict"; S[0] = "x"; return "stored"	209(S) { "use strict"; S[0] = "x"; return "stored"	210() { const S = tagc210\`a\${1}b\${2}c\`.raw; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	211(strings, ...rest) { const S = strings.raw; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	212(S) { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	213() { const S = tagc213\`a\${1}b\${2}c\`.raw; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	214(strings, ...rest) { const S = strings.raw; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	215(S) { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h, i) => `const tagc${9 * n} = (strings, ...rest) => strings;
function c${a}; }
function inc${b}; }
function c${9 * n + 1}() { return inc${9 * n + 1}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 2} = (strings, ...rest) => strings;
function hc${c}; }
function c${9 * n + 2}() { return hc${9 * n + 2}(tagc${9 * n + 2}\`a\${1}b\${2}c\`.raw); }
const tagc${9 * n + 3} = (strings, ...rest) => strings;
function c${d}; }
function inc${e}; }
function c${9 * n + 4}() { return inc${9 * n + 4}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 5} = (strings, ...rest) => strings;
function hc${f}; }
function c${9 * n + 5}() { return hc${9 * n + 5}(tagc${9 * n + 5}\`a\${1}b\${2}c\`.raw); }
const tagc${9 * n + 6} = (strings, ...rest) => strings;
function c${g}; }
function inc${h}; }
function c${9 * n + 7}() { return inc${9 * n + 7}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 8} = (strings, ...rest) => strings;
function hc${i}; }
function c${9 * n + 8}() { return hc${9 * n + 8}(tagc${9 * n + 8}\`a\${1}b\${2}c\`.raw); }`,
      ],
      `const cases = [["at here", c0], ["at in-tag", c1], ["at helper", c2], ["concat here", c3], ["concat in-tag", c4], ["concat helper", c5], ["concat-more here", c6], ["concat-more in-tag", c7], ["concat-more helper", c8], ["concat-onto here", c9], ["concat-onto in-tag", c10], ["concat-onto helper", c11], ["entries here", c12], ["entries in-tag", c13], ["entries helper", c14], ["every here", c15], ["every in-tag", c16], ["every helper", c17], ["filter here", c18], ["filter in-tag", c19], ["filter helper", c20], ["filter-length here", c21], ["filter-length in-tag", c22], ["filter-length helper", c23], ["find here", c24], ["find in-tag", c25], ["find helper", c26], ["findIndex here", c27], ["findIndex in-tag", c28], ["findIndex helper", c29], ["findLast here", c30], ["findLast in-tag", c31], ["findLast helper", c32], ["findLastIndex here", c33], ["findLastIndex in-tag", c34], ["findLastIndex helper", c35], ["flat here", c36], ["flat in-tag", c37], ["flat helper", c38], ["flatMap here", c39], ["flatMap in-tag", c40], ["flatMap helper", c41], ["forEach here", c42], ["forEach in-tag", c43], ["forEach helper", c44], ["forEach-method here", c45], ["forEach-method in-tag", c46], ["forEach-method helper", c47], ["includes here", c48], ["includes in-tag", c49], ["includes helper", c50], ["indexOf here", c51], ["indexOf in-tag", c52], ["indexOf helper", c53], ["join here", c54], ["join in-tag", c55], ["join helper", c56], ["keys here", c57], ["keys in-tag", c58], ["keys helper", c59], ["map here", c60], ["map in-tag", c61], ["map helper", c62], ["map-join here", c63], ["map-join in-tag", c64], ["map-join helper", c65], ["map-typeof here", c66], ["map-typeof in-tag", c67], ["map-typeof helper", c68], ["map-index here", c69], ["map-index in-tag", c70], ["map-index helper", c71], ["reduce here", c72], ["reduce in-tag", c73], ["reduce helper", c74], ["reduce-first here", c75], ["reduce-first in-tag", c76], ["reduce-first helper", c77], ["reduceRight here", c78], ["reduceRight in-tag", c79], ["reduceRight helper", c80], ["slice here", c81], ["slice in-tag", c82], ["slice helper", c83], ["slice-1 here", c84], ["slice-1 in-tag", c85], ["slice-1 helper", c86], ["some here", c87], ["some in-tag", c88], ["some helper", c89], ["toReversed here", c90], ["toReversed in-tag", c91], ["toReversed helper", c92], ["toSorted here", c93], ["toSorted in-tag", c94], ["toSorted helper", c95], ["toSpliced here", c96], ["toSpliced in-tag", c97], ["toSpliced helper", c98], ["with here", c99], ["with in-tag", c100], ["with helper", c101], ["toString here", c102], ["toString in-tag", c103], ["toString helper", c104], ["values here", c105], ["values in-tag", c106], ["values helper", c107], ["for-of here", c108], ["for-of in-tag", c109], ["for-of helper", c110], ["for-in here", c111], ["for-in in-tag", c112], ["for-in helper", c113], ["index-loop here", c114], ["index-loop in-tag", c115], ["index-loop helper", c116], ["spread here", c117], ["spread in-tag", c118], ["spread helper", c119], ["spread-call here", c120], ["spread-call in-tag", c121], ["spread-call helper", c122], ["destructure here", c123], ["destructure in-tag", c124], ["destructure helper", c125], ["Array.from here", c126], ["Array.from in-tag", c127], ["Array.from helper", c128], ["Array.from-map here", c129], ["Array.from-map in-tag", c130], ["Array.from-map helper", c131], ["Array.of here", c132], ["Array.of in-tag", c133], ["Array.of helper", c134], ["Object.values here", c135], ["Object.values in-tag", c136], ["Object.values helper", c137], ["Object.entries here", c138], ["Object.entries in-tag", c139], ["Object.entries helper", c140], ["Object.keys here", c141], ["Object.keys in-tag", c142], ["Object.keys helper", c143], ["Object.assign here", c144], ["Object.assign in-tag", c145], ["Object.assign helper", c146], ["object-spread here", c147], ["object-spread in-tag", c148], ["object-spread helper", c149], ["JSON here", c150], ["JSON in-tag", c151], ["JSON helper", c152], ["Set here", c153], ["Set in-tag", c154], ["Set helper", c155], ["Map here", c156], ["Map in-tag", c157], ["Map helper", c158], ["call-map here", c159], ["call-map in-tag", c160], ["call-map helper", c161], ["call-slice here", c162], ["call-slice in-tag", c163], ["call-slice helper", c164], ["apply here", c165], ["apply in-tag", c166], ["apply helper", c167], ["String.raw here", c168], ["String.raw in-tag", c169], ["String.raw helper", c170], ["structuredClone here", c171], ["structuredClone in-tag", c172], ["structuredClone helper", c173], ["isArray here", c174], ["isArray in-tag", c175], ["isArray helper", c176], ["descriptor here", c177], ["descriptor in-tag", c178], ["descriptor helper", c179], ["push here", c180], ["push in-tag", c181], ["push helper", c182], ["pop here", c183], ["pop in-tag", c184], ["pop helper", c185], ["shift here", c186], ["shift in-tag", c187], ["shift helper", c188], ["unshift here", c189], ["unshift in-tag", c190], ["unshift helper", c191], ["reverse here", c192], ["reverse in-tag", c193], ["reverse helper", c194], ["sort here", c195], ["sort in-tag", c196], ["sort helper", c197], ["splice here", c198], ["splice in-tag", c199], ["splice helper", c200], ["fill here", c201], ["fill in-tag", c202], ["fill helper", c203], ["copyWithin here", c204], ["copyWithin in-tag", c205], ["copyWithin helper", c206], ["store here", c207], ["store in-tag", c208], ["store helper", c209], ["chain here", c210], ["chain in-tag", c211], ["chain helper", c212], ["then-read here", c213], ["then-read in-tag", c214], ["then-read helper", c215]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-the-raw-strings-of-a-tagged-template.ts": text(
      `// Every method of Array.prototype, and what else reads a list, on the raw strings of a tagged template: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
// @ts-nocheck
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0(): string { const S: readonly string[] = tagc0\`a\${1}b\${2}c\`.raw; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(S: readonly string[]): string { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	3(): string { const S: readonly string[] = tagc3\`a\${1}b\${2}c\`.raw; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S: readonly string[]): string { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6(): string { const S: any = tagc6\`a\${1}b\${2}c\`.raw; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	8(S: any): string { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
9(): string { const S: readonly string[] = tagc9\`a\${1}b\${2}c\`.raw; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	10(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	11(S: readonly string[]): string { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	12(): string { const S: readonly string[] = tagc12\`a\${1}b\${2}c\`.raw; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	13(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	14(S: readonly string[]): string { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	15(): string { const S: readonly string[] = tagc15\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	16(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	17(S: readonly string[]): string { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t
18(): string { const S: readonly string[] = tagc18\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	19(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	20(S: readonly string[]): string { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	21(): string { const S: readonly string[] = tagc21\`a\${1}b\${2}c\`.raw; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	22(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	23(S: readonly string[]): string { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	24(): string { const S: readonly string[] = tagc24\`a\${1}b\${2}c\`.raw; const r = S.find(p => p !== undefined); return typeof r + ":" + r	25(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.find(p => p !== undefined); return typeof r + ":" + r	26(S: readonly string[]): string { const r = S.find(p => p !== undefined); return typeof r + ":" + r
27(): string { const S: readonly string[] = tagc27\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	28(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	29(S: readonly string[]): string { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	30(): string { const S: readonly string[] = tagc30\`a\${1}b\${2}c\`.raw; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	31(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	32(S: readonly string[]): string { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	33(): string { const S: readonly string[] = tagc33\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	34(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	35(S: readonly string[]): string { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
36(): string { const S: readonly string[] = tagc36\`a\${1}b\${2}c\`.raw; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	37(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	38(S: readonly string[]): string { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	39(): string { const S: readonly string[] = tagc39\`a\${1}b\${2}c\`.raw; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	40(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S: readonly string[]): string { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42(): string { const S: readonly string[] = tagc42\`a\${1}b\${2}c\`.raw; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	43(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	44(S: readonly string[]): string { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t
45(): string { const S: readonly string[] = tagc45\`a\${1}b\${2}c\`.raw; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	46(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	47(S: readonly string[]): string { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	48(): string { const S: readonly string[] = tagc48\`a\${1}b\${2}c\`.raw; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	49(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	50(S: readonly string[]): string { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	51(): string { const S: readonly string[] = tagc51\`a\${1}b\${2}c\`.raw; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	52(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	53(S: readonly string[]): string { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])
54(): string { const S: readonly string[] = tagc54\`a\${1}b\${2}c\`.raw; return S.join("+") + "|" + S.join()	55(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return S.join("+") + "|" + S.join()	56(S: readonly string[]): string { return S.join("+") + "|" + S.join()	57(): string { const S: readonly string[] = tagc57\`a\${1}b\${2}c\`.raw; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	58(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	59(S: readonly string[]): string { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	60(): string { const S: readonly string[] = tagc60\`a\${1}b\${2}c\`.raw; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(S: readonly string[]): string { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
63(): string { const S: readonly string[] = tagc63\`a\${1}b\${2}c\`.raw; return S.map(p => p + p).join()	64(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return S.map(p => p + p).join()	65(S: readonly string[]): string { return S.map(p => p + p).join()	66(): string { const S: readonly string[] = tagc66\`a\${1}b\${2}c\`.raw; return S.map(p => typeof p).join()	67(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return S.map(p => typeof p).join()	68(S: readonly string[]): string { return S.map(p => typeof p).join()	69(): string { const S: readonly string[] = tagc69\`a\${1}b\${2}c\`.raw; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	70(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	71(S: readonly string[]): string { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
72(): string { const S: readonly string[] = tagc72\`a\${1}b\${2}c\`.raw; return S.reduce((t, p, i) => t + typeof p + p + i, "")	73(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return S.reduce((t, p, i) => t + typeof p + p + i, "")	74(S: readonly string[]): string { return S.reduce((t, p, i) => t + typeof p + p + i, "")	75(): string { const S: readonly string[] = tagc75\`a\${1}b\${2}c\`.raw; const r = S.reduce((a, b) => a); return typeof r + ":" + r	76(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.reduce((a, b) => a); return typeof r + ":" + r	77(S: readonly string[]): string { const r = S.reduce((a, b) => a); return typeof r + ":" + r	78(): string { const S: readonly string[] = tagc78\`a\${1}b\${2}c\`.raw; return S.reduceRight((t, p) => t + typeof p + p, "")	79(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return S.reduceRight((t, p) => t + typeof p + p, "")	80(S: readonly string[]): string { return S.reduceRight((t, p) => t + typeof p + p, "")
81(): string { const S: readonly string[] = tagc81\`a\${1}b\${2}c\`.raw; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	82(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	83(S: readonly string[]): string { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	84(): string { const S: readonly string[] = tagc84\`a\${1}b\${2}c\`.raw; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	85(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	86(S: readonly string[]): string { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	87(): string { const S: readonly string[] = tagc87\`a\${1}b\${2}c\`.raw; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	88(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	89(S: readonly string[]): string { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t
90(): string { const S: readonly string[] = tagc90\`a\${1}b\${2}c\`.raw; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(S: readonly string[]): string { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	93(): string { const S: readonly string[] = tagc93\`a\${1}b\${2}c\`.raw; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	94(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	95(S: readonly string[]): string { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	96(): string { const S: any = tagc96\`a\${1}b\${2}c\`.raw; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(S: any): string { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
99(): string { const S: any = tagc99\`a\${1}b\${2}c\`.raw; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	100(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	101(S: any): string { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	102(): string { const S: readonly string[] = tagc102\`a\${1}b\${2}c\`.raw; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	103(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	104(S: readonly string[]): string { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	105(): string { const S: readonly string[] = tagc105\`a\${1}b\${2}c\`.raw; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	106(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	107(S: readonly string[]): string { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
108(): string { const S: readonly string[] = tagc108\`a\${1}b\${2}c\`.raw; let t = ""; for (const p of S) t += typeof p + p + ","; return t	109(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; for (const p of S) t += typeof p + p + ","; return t	110(S: readonly string[]): string { let t = ""; for (const p of S) t += typeof p + p + ","; return t	111(): string { const S: readonly string[] = tagc111\`a\${1}b\${2}c\`.raw; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	112(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	113(S: readonly string[]): string { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	114(): string { const S: readonly string[] = tagc114\`a\${1}b\${2}c\`.raw; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	115(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	116(S: readonly string[]): string { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t
117(): string { const S: readonly string[] = tagc117\`a\${1}b\${2}c\`.raw; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	118(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	119(S: readonly string[]): string { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	120(): string { const S: readonly string[] = tagc120\`a\${1}b\${2}c\`.raw; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	121(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	122(S: readonly string[]): string { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	123(): string { const S: readonly string[] = tagc123\`a\${1}b\${2}c\`.raw; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	124(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	125(S: readonly string[]): string { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)
126(): string { const S: readonly string[] = tagc126\`a\${1}b\${2}c\`.raw; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	127(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	128(S: readonly string[]): string { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	129(): string { const S: readonly string[] = tagc129\`a\${1}b\${2}c\`.raw; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	130(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	131(S: readonly string[]): string { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	132(): string { const S: readonly string[] = tagc132\`a\${1}b\${2}c\`.raw; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	133(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	134(S: readonly string[]): string { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
135(): string { const S: readonly string[] = tagc135\`a\${1}b\${2}c\`.raw; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	136(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	137(S: readonly string[]): string { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	138(): string { const S: readonly string[] = tagc138\`a\${1}b\${2}c\`.raw; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	139(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	140(S: readonly string[]): string { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	141(): string { const S: readonly string[] = tagc141\`a\${1}b\${2}c\`.raw; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	142(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	143(S: readonly string[]): string { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
144(): string { const S: readonly string[] = tagc144\`a\${1}b\${2}c\`.raw; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	145(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	146(S: readonly string[]): string { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	147(): string { const S: readonly string[] = tagc147\`a\${1}b\${2}c\`.raw; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	148(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	149(S: readonly string[]): string { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	150(): string { const S: readonly string[] = tagc150\`a\${1}b\${2}c\`.raw; return JSON.stringify(S)	151(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return JSON.stringify(S)	152(S: readonly string[]): string { return JSON.stringify(S)
153(): string { const S: readonly string[] = tagc153\`a\${1}b\${2}c\`.raw; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	154(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	155(S: readonly string[]): string { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	156(): string { const S: readonly string[] = tagc156\`a\${1}b\${2}c\`.raw; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	157(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	158(S: readonly string[]): string { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	159(): string { const S: readonly string[] = tagc159\`a\${1}b\${2}c\`.raw; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	160(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	161(S: readonly string[]): string { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
162(): string { const S: readonly string[] = tagc162\`a\${1}b\${2}c\`.raw; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	163(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	164(S: readonly string[]): string { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	165(): string { const S: any = tagc165\`a\${1}b\${2}c\`.raw; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	166(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	167(S: any): string { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	168(): string { const S: any = tagc168\`a\${1}b\${2}c\`.raw; return String.raw({ raw: S }, 1, 2)	169(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return String.raw({ raw: S }, 1, 2)	170(S: any): string { return String.raw({ raw: S }, 1, 2)
171(): string { const S: readonly string[] = tagc171\`a\${1}b\${2}c\`.raw; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	172(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	173(S: readonly string[]): string { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	174(): string { const S: readonly string[] = tagc174\`a\${1}b\${2}c\`.raw; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	175(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	176(S: readonly string[]): string { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	177(): string { const S: readonly string[] = tagc177\`a\${1}b\${2}c\`.raw; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	178(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: readonly string[] = strings.raw; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	179(S: readonly string[]): string { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
180(): string { const S: any = tagc180\`a\${1}b\${2}c\`.raw; S.push("x"); return "pushed"	181(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; S.push("x"); return "pushed"	182(S: any): string { S.push("x"); return "pushed"	183(): string { const S: any = tagc183\`a\${1}b\${2}c\`.raw; return "popped " + S.pop()	184(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return "popped " + S.pop()	185(S: any): string { return "popped " + S.pop()	186(): string { const S: any = tagc186\`a\${1}b\${2}c\`.raw; return "shifted " + S.shift()	187(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return "shifted " + S.shift()	188(S: any): string { return "shifted " + S.shift()
189(): string { const S: any = tagc189\`a\${1}b\${2}c\`.raw; S.unshift("x"); return "unshifted"	190(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; S.unshift("x"); return "unshifted"	191(S: any): string { S.unshift("x"); return "unshifted"	192(): string { const S: any = tagc192\`a\${1}b\${2}c\`.raw; return show(S.reverse())	193(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return show(S.reverse())	194(S: any): string { return show(S.reverse())	195(): string { const S: any = tagc195\`a\${1}b\${2}c\`.raw; return show(S.sort())	196(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return show(S.sort())	197(S: any): string { return show(S.sort())
198(): string { const S: any = tagc198\`a\${1}b\${2}c\`.raw; return show(S.splice(0, 1))	199(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return show(S.splice(0, 1))	200(S: any): string { return show(S.splice(0, 1))	201(): string { const S: any = tagc201\`a\${1}b\${2}c\`.raw; return show(S.fill("f"))	202(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return show(S.fill("f"))	203(S: any): string { return show(S.fill("f"))	204(): string { const S: any = tagc204\`a\${1}b\${2}c\`.raw; return show(S.copyWithin(0, 1))	205(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return show(S.copyWithin(0, 1))	206(S: any): string { return show(S.copyWithin(0, 1))
207(): string { const S: any = tagc207\`a\${1}b\${2}c\`.raw; "use strict"; S[0] = "x"; return "stored"	208(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; "use strict"; S[0] = "x"; return "stored"	209(S: any): string { "use strict"; S[0] = "x"; return "stored"	210(): string { const S: any = tagc210\`a\${1}b\${2}c\`.raw; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	211(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	212(S: any): string { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	213(): string { const S: any = tagc213\`a\${1}b\${2}c\`.raw; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	214(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings.raw; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	215(S: any): string { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (
          n,
          a,
          b,
          c,
          d,
          e,
          f,
          g,
          h,
          i,
        ) => `const tagc${9 * n} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${a}; }
function inc${b}; }
function c${9 * n + 1}(): string { return inc${9 * n + 1}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 2} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${c}; }
function c${9 * n + 2}(): string { return hc${9 * n + 2}(tagc${9 * n + 2}\`a\${1}b\${2}c\`.raw); }
const tagc${9 * n + 3} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${d}; }
function inc${e}; }
function c${9 * n + 4}(): string { return inc${9 * n + 4}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 5} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${f}; }
function c${9 * n + 5}(): string { return hc${9 * n + 5}(tagc${9 * n + 5}\`a\${1}b\${2}c\`.raw); }
const tagc${9 * n + 6} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${g}; }
function inc${h}; }
function c${9 * n + 7}(): string { return inc${9 * n + 7}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 8} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${i}; }
function c${9 * n + 8}(): string { return hc${9 * n + 8}(tagc${9 * n + 8}\`a\${1}b\${2}c\`.raw); }`,
      ],
      `const cases: [string, () => string][] = [["at here", c0], ["at in-tag", c1], ["at helper", c2], ["concat here", c3], ["concat in-tag", c4], ["concat helper", c5], ["concat-more here", c6], ["concat-more in-tag", c7], ["concat-more helper", c8], ["concat-onto here", c9], ["concat-onto in-tag", c10], ["concat-onto helper", c11], ["entries here", c12], ["entries in-tag", c13], ["entries helper", c14], ["every here", c15], ["every in-tag", c16], ["every helper", c17], ["filter here", c18], ["filter in-tag", c19], ["filter helper", c20], ["filter-length here", c21], ["filter-length in-tag", c22], ["filter-length helper", c23], ["find here", c24], ["find in-tag", c25], ["find helper", c26], ["findIndex here", c27], ["findIndex in-tag", c28], ["findIndex helper", c29], ["findLast here", c30], ["findLast in-tag", c31], ["findLast helper", c32], ["findLastIndex here", c33], ["findLastIndex in-tag", c34], ["findLastIndex helper", c35], ["flat here", c36], ["flat in-tag", c37], ["flat helper", c38], ["flatMap here", c39], ["flatMap in-tag", c40], ["flatMap helper", c41], ["forEach here", c42], ["forEach in-tag", c43], ["forEach helper", c44], ["forEach-method here", c45], ["forEach-method in-tag", c46], ["forEach-method helper", c47], ["includes here", c48], ["includes in-tag", c49], ["includes helper", c50], ["indexOf here", c51], ["indexOf in-tag", c52], ["indexOf helper", c53], ["join here", c54], ["join in-tag", c55], ["join helper", c56], ["keys here", c57], ["keys in-tag", c58], ["keys helper", c59], ["map here", c60], ["map in-tag", c61], ["map helper", c62], ["map-join here", c63], ["map-join in-tag", c64], ["map-join helper", c65], ["map-typeof here", c66], ["map-typeof in-tag", c67], ["map-typeof helper", c68], ["map-index here", c69], ["map-index in-tag", c70], ["map-index helper", c71], ["reduce here", c72], ["reduce in-tag", c73], ["reduce helper", c74], ["reduce-first here", c75], ["reduce-first in-tag", c76], ["reduce-first helper", c77], ["reduceRight here", c78], ["reduceRight in-tag", c79], ["reduceRight helper", c80], ["slice here", c81], ["slice in-tag", c82], ["slice helper", c83], ["slice-1 here", c84], ["slice-1 in-tag", c85], ["slice-1 helper", c86], ["some here", c87], ["some in-tag", c88], ["some helper", c89], ["toReversed here", c90], ["toReversed in-tag", c91], ["toReversed helper", c92], ["toSorted here", c93], ["toSorted in-tag", c94], ["toSorted helper", c95], ["toSpliced here", c96], ["toSpliced in-tag", c97], ["toSpliced helper", c98], ["with here", c99], ["with in-tag", c100], ["with helper", c101], ["toString here", c102], ["toString in-tag", c103], ["toString helper", c104], ["values here", c105], ["values in-tag", c106], ["values helper", c107], ["for-of here", c108], ["for-of in-tag", c109], ["for-of helper", c110], ["for-in here", c111], ["for-in in-tag", c112], ["for-in helper", c113], ["index-loop here", c114], ["index-loop in-tag", c115], ["index-loop helper", c116], ["spread here", c117], ["spread in-tag", c118], ["spread helper", c119], ["spread-call here", c120], ["spread-call in-tag", c121], ["spread-call helper", c122], ["destructure here", c123], ["destructure in-tag", c124], ["destructure helper", c125], ["Array.from here", c126], ["Array.from in-tag", c127], ["Array.from helper", c128], ["Array.from-map here", c129], ["Array.from-map in-tag", c130], ["Array.from-map helper", c131], ["Array.of here", c132], ["Array.of in-tag", c133], ["Array.of helper", c134], ["Object.values here", c135], ["Object.values in-tag", c136], ["Object.values helper", c137], ["Object.entries here", c138], ["Object.entries in-tag", c139], ["Object.entries helper", c140], ["Object.keys here", c141], ["Object.keys in-tag", c142], ["Object.keys helper", c143], ["Object.assign here", c144], ["Object.assign in-tag", c145], ["Object.assign helper", c146], ["object-spread here", c147], ["object-spread in-tag", c148], ["object-spread helper", c149], ["JSON here", c150], ["JSON in-tag", c151], ["JSON helper", c152], ["Set here", c153], ["Set in-tag", c154], ["Set helper", c155], ["Map here", c156], ["Map in-tag", c157], ["Map helper", c158], ["call-map here", c159], ["call-map in-tag", c160], ["call-map helper", c161], ["call-slice here", c162], ["call-slice in-tag", c163], ["call-slice helper", c164], ["apply here", c165], ["apply in-tag", c166], ["apply helper", c167], ["String.raw here", c168], ["String.raw in-tag", c169], ["String.raw helper", c170], ["structuredClone here", c171], ["structuredClone in-tag", c172], ["structuredClone helper", c173], ["isArray here", c174], ["isArray in-tag", c175], ["isArray helper", c176], ["descriptor here", c177], ["descriptor in-tag", c178], ["descriptor helper", c179], ["push here", c180], ["push in-tag", c181], ["push helper", c182], ["pop here", c183], ["pop in-tag", c184], ["pop helper", c185], ["shift here", c186], ["shift in-tag", c187], ["shift helper", c188], ["unshift here", c189], ["unshift in-tag", c190], ["unshift helper", c191], ["reverse here", c192], ["reverse in-tag", c193], ["reverse helper", c194], ["sort here", c195], ["sort in-tag", c196], ["sort helper", c197], ["splice here", c198], ["splice in-tag", c199], ["splice helper", c200], ["fill here", c201], ["fill in-tag", c202], ["fill helper", c203], ["copyWithin here", c204], ["copyWithin in-tag", c205], ["copyWithin helper", c206], ["store here", c207], ["store in-tag", c208], ["store helper", c209], ["chain here", c210], ["chain in-tag", c211], ["chain helper", c212], ["then-read here", c213], ["then-read in-tag", c214], ["then-read helper", c215]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e as any).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-the-strings-of-a-tagged-template-with-an-escape-that-means-nothing.js": text(
      `// Every method of Array.prototype, and what else reads a list, on the strings of a tagged template with an escape that means nothing: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
function show(v) {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0() { const S = tagc0\`\\unicode\${1}b\${2}c\`; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(strings, ...rest) { const S = strings; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(S) { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	3() { const S = tagc3\`\\unicode\${1}b\${2}c\`; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(strings, ...rest) { const S = strings; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S) { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6() { const S = tagc6\`\\unicode\${1}b\${2}c\`; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(strings, ...rest) { const S = strings; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	8(S) { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
9() { const S = tagc9\`\\unicode\${1}b\${2}c\`; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	10(strings, ...rest) { const S = strings; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	11(S) { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	12() { const S = tagc12\`\\unicode\${1}b\${2}c\`; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	13(strings, ...rest) { const S = strings; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	14(S) { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	15() { const S = tagc15\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	16(strings, ...rest) { const S = strings; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	17(S) { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t
18() { const S = tagc18\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	19(strings, ...rest) { const S = strings; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	20(S) { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	21() { const S = tagc21\`\\unicode\${1}b\${2}c\`; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	22(strings, ...rest) { const S = strings; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	23(S) { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	24() { const S = tagc24\`\\unicode\${1}b\${2}c\`; const r = S.find(p => p !== undefined); return typeof r + ":" + r	25(strings, ...rest) { const S = strings; const r = S.find(p => p !== undefined); return typeof r + ":" + r	26(S) { const r = S.find(p => p !== undefined); return typeof r + ":" + r
27() { const S = tagc27\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	28(strings, ...rest) { const S = strings; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	29(S) { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	30() { const S = tagc30\`\\unicode\${1}b\${2}c\`; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	31(strings, ...rest) { const S = strings; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	32(S) { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	33() { const S = tagc33\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	34(strings, ...rest) { const S = strings; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	35(S) { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
36() { const S = tagc36\`\\unicode\${1}b\${2}c\`; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	37(strings, ...rest) { const S = strings; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	38(S) { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	39() { const S = tagc39\`\\unicode\${1}b\${2}c\`; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	40(strings, ...rest) { const S = strings; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S) { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42() { const S = tagc42\`\\unicode\${1}b\${2}c\`; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	43(strings, ...rest) { const S = strings; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	44(S) { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t
45() { const S = tagc45\`\\unicode\${1}b\${2}c\`; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	46(strings, ...rest) { const S = strings; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	47(S) { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	48() { const S = tagc48\`\\unicode\${1}b\${2}c\`; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	49(strings, ...rest) { const S = strings; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	50(S) { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	51() { const S = tagc51\`\\unicode\${1}b\${2}c\`; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	52(strings, ...rest) { const S = strings; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	53(S) { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])
54() { const S = tagc54\`\\unicode\${1}b\${2}c\`; return S.join("+") + "|" + S.join()	55(strings, ...rest) { const S = strings; return S.join("+") + "|" + S.join()	56(S) { return S.join("+") + "|" + S.join()	57() { const S = tagc57\`\\unicode\${1}b\${2}c\`; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	58(strings, ...rest) { const S = strings; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	59(S) { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	60() { const S = tagc60\`\\unicode\${1}b\${2}c\`; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(strings, ...rest) { const S = strings; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(S) { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
63() { const S = tagc63\`\\unicode\${1}b\${2}c\`; return S.map(p => p + p).join()	64(strings, ...rest) { const S = strings; return S.map(p => p + p).join()	65(S) { return S.map(p => p + p).join()	66() { const S = tagc66\`\\unicode\${1}b\${2}c\`; return S.map(p => typeof p).join()	67(strings, ...rest) { const S = strings; return S.map(p => typeof p).join()	68(S) { return S.map(p => typeof p).join()	69() { const S = tagc69\`\\unicode\${1}b\${2}c\`; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	70(strings, ...rest) { const S = strings; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	71(S) { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
72() { const S = tagc72\`\\unicode\${1}b\${2}c\`; return S.reduce((t, p, i) => t + typeof p + p + i, "")	73(strings, ...rest) { const S = strings; return S.reduce((t, p, i) => t + typeof p + p + i, "")	74(S) { return S.reduce((t, p, i) => t + typeof p + p + i, "")	75() { const S = tagc75\`\\unicode\${1}b\${2}c\`; const r = S.reduce((a, b) => a); return typeof r + ":" + r	76(strings, ...rest) { const S = strings; const r = S.reduce((a, b) => a); return typeof r + ":" + r	77(S) { const r = S.reduce((a, b) => a); return typeof r + ":" + r	78() { const S = tagc78\`\\unicode\${1}b\${2}c\`; return S.reduceRight((t, p) => t + typeof p + p, "")	79(strings, ...rest) { const S = strings; return S.reduceRight((t, p) => t + typeof p + p, "")	80(S) { return S.reduceRight((t, p) => t + typeof p + p, "")
81() { const S = tagc81\`\\unicode\${1}b\${2}c\`; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	82(strings, ...rest) { const S = strings; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	83(S) { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	84() { const S = tagc84\`\\unicode\${1}b\${2}c\`; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	85(strings, ...rest) { const S = strings; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	86(S) { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	87() { const S = tagc87\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	88(strings, ...rest) { const S = strings; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	89(S) { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t
90() { const S = tagc90\`\\unicode\${1}b\${2}c\`; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(strings, ...rest) { const S = strings; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(S) { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	93() { const S = tagc93\`\\unicode\${1}b\${2}c\`; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	94(strings, ...rest) { const S = strings; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	95(S) { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	96() { const S = tagc96\`\\unicode\${1}b\${2}c\`; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(strings, ...rest) { const S = strings; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(S) { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
99() { const S = tagc99\`\\unicode\${1}b\${2}c\`; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	100(strings, ...rest) { const S = strings; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	101(S) { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	102() { const S = tagc102\`\\unicode\${1}b\${2}c\`; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	103(strings, ...rest) { const S = strings; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	104(S) { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	105() { const S = tagc105\`\\unicode\${1}b\${2}c\`; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	106(strings, ...rest) { const S = strings; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	107(S) { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
108() { const S = tagc108\`\\unicode\${1}b\${2}c\`; let t = ""; for (const p of S) t += typeof p + p + ","; return t	109(strings, ...rest) { const S = strings; let t = ""; for (const p of S) t += typeof p + p + ","; return t	110(S) { let t = ""; for (const p of S) t += typeof p + p + ","; return t	111() { const S = tagc111\`\\unicode\${1}b\${2}c\`; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	112(strings, ...rest) { const S = strings; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	113(S) { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	114() { const S = tagc114\`\\unicode\${1}b\${2}c\`; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	115(strings, ...rest) { const S = strings; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	116(S) { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t
117() { const S = tagc117\`\\unicode\${1}b\${2}c\`; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	118(strings, ...rest) { const S = strings; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	119(S) { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	120() { const S = tagc120\`\\unicode\${1}b\${2}c\`; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	121(strings, ...rest) { const S = strings; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	122(S) { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	123() { const S = tagc123\`\\unicode\${1}b\${2}c\`; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	124(strings, ...rest) { const S = strings; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	125(S) { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)
126() { const S = tagc126\`\\unicode\${1}b\${2}c\`; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	127(strings, ...rest) { const S = strings; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	128(S) { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	129() { const S = tagc129\`\\unicode\${1}b\${2}c\`; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	130(strings, ...rest) { const S = strings; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	131(S) { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	132() { const S = tagc132\`\\unicode\${1}b\${2}c\`; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	133(strings, ...rest) { const S = strings; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	134(S) { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
135() { const S = tagc135\`\\unicode\${1}b\${2}c\`; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	136(strings, ...rest) { const S = strings; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	137(S) { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	138() { const S = tagc138\`\\unicode\${1}b\${2}c\`; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	139(strings, ...rest) { const S = strings; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	140(S) { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	141() { const S = tagc141\`\\unicode\${1}b\${2}c\`; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	142(strings, ...rest) { const S = strings; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	143(S) { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
144() { const S = tagc144\`\\unicode\${1}b\${2}c\`; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	145(strings, ...rest) { const S = strings; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	146(S) { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	147() { const S = tagc147\`\\unicode\${1}b\${2}c\`; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	148(strings, ...rest) { const S = strings; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	149(S) { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	150() { const S = tagc150\`\\unicode\${1}b\${2}c\`; return JSON.stringify(S)	151(strings, ...rest) { const S = strings; return JSON.stringify(S)	152(S) { return JSON.stringify(S)
153() { const S = tagc153\`\\unicode\${1}b\${2}c\`; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	154(strings, ...rest) { const S = strings; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	155(S) { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	156() { const S = tagc156\`\\unicode\${1}b\${2}c\`; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	157(strings, ...rest) { const S = strings; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	158(S) { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	159() { const S = tagc159\`\\unicode\${1}b\${2}c\`; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	160(strings, ...rest) { const S = strings; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	161(S) { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
162() { const S = tagc162\`\\unicode\${1}b\${2}c\`; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	163(strings, ...rest) { const S = strings; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	164(S) { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	165() { const S = tagc165\`\\unicode\${1}b\${2}c\`; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	166(strings, ...rest) { const S = strings; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	167(S) { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	168() { const S = tagc168\`\\unicode\${1}b\${2}c\`; return String.raw({ raw: S }, 1, 2)	169(strings, ...rest) { const S = strings; return String.raw({ raw: S }, 1, 2)	170(S) { return String.raw({ raw: S }, 1, 2)
171() { const S = tagc171\`\\unicode\${1}b\${2}c\`; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	172(strings, ...rest) { const S = strings; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	173(S) { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	174() { const S = tagc174\`\\unicode\${1}b\${2}c\`; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	175(strings, ...rest) { const S = strings; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	176(S) { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	177() { const S = tagc177\`\\unicode\${1}b\${2}c\`; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	178(strings, ...rest) { const S = strings; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	179(S) { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
180() { const S = tagc180\`\\unicode\${1}b\${2}c\`; S.push("x"); return "pushed"	181(strings, ...rest) { const S = strings; S.push("x"); return "pushed"	182(S) { S.push("x"); return "pushed"	183() { const S = tagc183\`\\unicode\${1}b\${2}c\`; return "popped " + S.pop()	184(strings, ...rest) { const S = strings; return "popped " + S.pop()	185(S) { return "popped " + S.pop()	186() { const S = tagc186\`\\unicode\${1}b\${2}c\`; return "shifted " + S.shift()	187(strings, ...rest) { const S = strings; return "shifted " + S.shift()	188(S) { return "shifted " + S.shift()
189() { const S = tagc189\`\\unicode\${1}b\${2}c\`; S.unshift("x"); return "unshifted"	190(strings, ...rest) { const S = strings; S.unshift("x"); return "unshifted"	191(S) { S.unshift("x"); return "unshifted"	192() { const S = tagc192\`\\unicode\${1}b\${2}c\`; return show(S.reverse())	193(strings, ...rest) { const S = strings; return show(S.reverse())	194(S) { return show(S.reverse())	195() { const S = tagc195\`\\unicode\${1}b\${2}c\`; return show(S.sort())	196(strings, ...rest) { const S = strings; return show(S.sort())	197(S) { return show(S.sort())
198() { const S = tagc198\`\\unicode\${1}b\${2}c\`; return show(S.splice(0, 1))	199(strings, ...rest) { const S = strings; return show(S.splice(0, 1))	200(S) { return show(S.splice(0, 1))	201() { const S = tagc201\`\\unicode\${1}b\${2}c\`; return show(S.fill("f"))	202(strings, ...rest) { const S = strings; return show(S.fill("f"))	203(S) { return show(S.fill("f"))	204() { const S = tagc204\`\\unicode\${1}b\${2}c\`; return show(S.copyWithin(0, 1))	205(strings, ...rest) { const S = strings; return show(S.copyWithin(0, 1))	206(S) { return show(S.copyWithin(0, 1))
207() { const S = tagc207\`\\unicode\${1}b\${2}c\`; "use strict"; S[0] = "x"; return "stored"	208(strings, ...rest) { const S = strings; "use strict"; S[0] = "x"; return "stored"	209(S) { "use strict"; S[0] = "x"; return "stored"	210() { const S = tagc210\`\\unicode\${1}b\${2}c\`; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	211(strings, ...rest) { const S = strings; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	212(S) { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	213() { const S = tagc213\`\\unicode\${1}b\${2}c\`; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	214(strings, ...rest) { const S = strings; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	215(S) { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h, i) => `const tagc${9 * n} = (strings, ...rest) => strings;
function c${a}; }
function inc${b}; }
function c${9 * n + 1}() { return inc${9 * n + 1}\`\\unicode\${1}b\${2}c\`; }
const tagc${9 * n + 2} = (strings, ...rest) => strings;
function hc${c}; }
function c${9 * n + 2}() { return hc${9 * n + 2}(tagc${9 * n + 2}\`\\unicode\${1}b\${2}c\`); }
const tagc${9 * n + 3} = (strings, ...rest) => strings;
function c${d}; }
function inc${e}; }
function c${9 * n + 4}() { return inc${9 * n + 4}\`\\unicode\${1}b\${2}c\`; }
const tagc${9 * n + 5} = (strings, ...rest) => strings;
function hc${f}; }
function c${9 * n + 5}() { return hc${9 * n + 5}(tagc${9 * n + 5}\`\\unicode\${1}b\${2}c\`); }
const tagc${9 * n + 6} = (strings, ...rest) => strings;
function c${g}; }
function inc${h}; }
function c${9 * n + 7}() { return inc${9 * n + 7}\`\\unicode\${1}b\${2}c\`; }
const tagc${9 * n + 8} = (strings, ...rest) => strings;
function hc${i}; }
function c${9 * n + 8}() { return hc${9 * n + 8}(tagc${9 * n + 8}\`\\unicode\${1}b\${2}c\`); }`,
      ],
      `const cases = [["at here", c0], ["at in-tag", c1], ["at helper", c2], ["concat here", c3], ["concat in-tag", c4], ["concat helper", c5], ["concat-more here", c6], ["concat-more in-tag", c7], ["concat-more helper", c8], ["concat-onto here", c9], ["concat-onto in-tag", c10], ["concat-onto helper", c11], ["entries here", c12], ["entries in-tag", c13], ["entries helper", c14], ["every here", c15], ["every in-tag", c16], ["every helper", c17], ["filter here", c18], ["filter in-tag", c19], ["filter helper", c20], ["filter-length here", c21], ["filter-length in-tag", c22], ["filter-length helper", c23], ["find here", c24], ["find in-tag", c25], ["find helper", c26], ["findIndex here", c27], ["findIndex in-tag", c28], ["findIndex helper", c29], ["findLast here", c30], ["findLast in-tag", c31], ["findLast helper", c32], ["findLastIndex here", c33], ["findLastIndex in-tag", c34], ["findLastIndex helper", c35], ["flat here", c36], ["flat in-tag", c37], ["flat helper", c38], ["flatMap here", c39], ["flatMap in-tag", c40], ["flatMap helper", c41], ["forEach here", c42], ["forEach in-tag", c43], ["forEach helper", c44], ["forEach-method here", c45], ["forEach-method in-tag", c46], ["forEach-method helper", c47], ["includes here", c48], ["includes in-tag", c49], ["includes helper", c50], ["indexOf here", c51], ["indexOf in-tag", c52], ["indexOf helper", c53], ["join here", c54], ["join in-tag", c55], ["join helper", c56], ["keys here", c57], ["keys in-tag", c58], ["keys helper", c59], ["map here", c60], ["map in-tag", c61], ["map helper", c62], ["map-join here", c63], ["map-join in-tag", c64], ["map-join helper", c65], ["map-typeof here", c66], ["map-typeof in-tag", c67], ["map-typeof helper", c68], ["map-index here", c69], ["map-index in-tag", c70], ["map-index helper", c71], ["reduce here", c72], ["reduce in-tag", c73], ["reduce helper", c74], ["reduce-first here", c75], ["reduce-first in-tag", c76], ["reduce-first helper", c77], ["reduceRight here", c78], ["reduceRight in-tag", c79], ["reduceRight helper", c80], ["slice here", c81], ["slice in-tag", c82], ["slice helper", c83], ["slice-1 here", c84], ["slice-1 in-tag", c85], ["slice-1 helper", c86], ["some here", c87], ["some in-tag", c88], ["some helper", c89], ["toReversed here", c90], ["toReversed in-tag", c91], ["toReversed helper", c92], ["toSorted here", c93], ["toSorted in-tag", c94], ["toSorted helper", c95], ["toSpliced here", c96], ["toSpliced in-tag", c97], ["toSpliced helper", c98], ["with here", c99], ["with in-tag", c100], ["with helper", c101], ["toString here", c102], ["toString in-tag", c103], ["toString helper", c104], ["values here", c105], ["values in-tag", c106], ["values helper", c107], ["for-of here", c108], ["for-of in-tag", c109], ["for-of helper", c110], ["for-in here", c111], ["for-in in-tag", c112], ["for-in helper", c113], ["index-loop here", c114], ["index-loop in-tag", c115], ["index-loop helper", c116], ["spread here", c117], ["spread in-tag", c118], ["spread helper", c119], ["spread-call here", c120], ["spread-call in-tag", c121], ["spread-call helper", c122], ["destructure here", c123], ["destructure in-tag", c124], ["destructure helper", c125], ["Array.from here", c126], ["Array.from in-tag", c127], ["Array.from helper", c128], ["Array.from-map here", c129], ["Array.from-map in-tag", c130], ["Array.from-map helper", c131], ["Array.of here", c132], ["Array.of in-tag", c133], ["Array.of helper", c134], ["Object.values here", c135], ["Object.values in-tag", c136], ["Object.values helper", c137], ["Object.entries here", c138], ["Object.entries in-tag", c139], ["Object.entries helper", c140], ["Object.keys here", c141], ["Object.keys in-tag", c142], ["Object.keys helper", c143], ["Object.assign here", c144], ["Object.assign in-tag", c145], ["Object.assign helper", c146], ["object-spread here", c147], ["object-spread in-tag", c148], ["object-spread helper", c149], ["JSON here", c150], ["JSON in-tag", c151], ["JSON helper", c152], ["Set here", c153], ["Set in-tag", c154], ["Set helper", c155], ["Map here", c156], ["Map in-tag", c157], ["Map helper", c158], ["call-map here", c159], ["call-map in-tag", c160], ["call-map helper", c161], ["call-slice here", c162], ["call-slice in-tag", c163], ["call-slice helper", c164], ["apply here", c165], ["apply in-tag", c166], ["apply helper", c167], ["String.raw here", c168], ["String.raw in-tag", c169], ["String.raw helper", c170], ["structuredClone here", c171], ["structuredClone in-tag", c172], ["structuredClone helper", c173], ["isArray here", c174], ["isArray in-tag", c175], ["isArray helper", c176], ["descriptor here", c177], ["descriptor in-tag", c178], ["descriptor helper", c179], ["push here", c180], ["push in-tag", c181], ["push helper", c182], ["pop here", c183], ["pop in-tag", c184], ["pop helper", c185], ["shift here", c186], ["shift in-tag", c187], ["shift helper", c188], ["unshift here", c189], ["unshift in-tag", c190], ["unshift helper", c191], ["reverse here", c192], ["reverse in-tag", c193], ["reverse helper", c194], ["sort here", c195], ["sort in-tag", c196], ["sort helper", c197], ["splice here", c198], ["splice in-tag", c199], ["splice helper", c200], ["fill here", c201], ["fill in-tag", c202], ["fill helper", c203], ["copyWithin here", c204], ["copyWithin in-tag", c205], ["copyWithin helper", c206], ["store here", c207], ["store in-tag", c208], ["store helper", c209], ["chain here", c210], ["chain in-tag", c211], ["chain helper", c212], ["then-read here", c213], ["then-read in-tag", c214], ["then-read helper", c215]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-the-strings-of-a-tagged-template-with-an-escape-that-means-nothing.ts": text(
      `// Every method of Array.prototype, and what else reads a list, on the strings of a tagged template with an escape that means nothing: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
// @ts-nocheck
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0(): string { const S: TemplateStringsArray = tagc0\`\\unicode\${1}b\${2}c\`; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(S: TemplateStringsArray): string { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	3(): string { const S: TemplateStringsArray = tagc3\`\\unicode\${1}b\${2}c\`; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S: TemplateStringsArray): string { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6(): string { const S: any = tagc6\`\\unicode\${1}b\${2}c\`; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	8(S: any): string { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
9(): string { const S: TemplateStringsArray = tagc9\`\\unicode\${1}b\${2}c\`; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	10(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	11(S: TemplateStringsArray): string { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	12(): string { const S: TemplateStringsArray = tagc12\`\\unicode\${1}b\${2}c\`; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	13(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	14(S: TemplateStringsArray): string { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	15(): string { const S: TemplateStringsArray = tagc15\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	16(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	17(S: TemplateStringsArray): string { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t
18(): string { const S: TemplateStringsArray = tagc18\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	19(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	20(S: TemplateStringsArray): string { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	21(): string { const S: TemplateStringsArray = tagc21\`\\unicode\${1}b\${2}c\`; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	22(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	23(S: TemplateStringsArray): string { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	24(): string { const S: TemplateStringsArray = tagc24\`\\unicode\${1}b\${2}c\`; const r = S.find(p => p !== undefined); return typeof r + ":" + r	25(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.find(p => p !== undefined); return typeof r + ":" + r	26(S: TemplateStringsArray): string { const r = S.find(p => p !== undefined); return typeof r + ":" + r
27(): string { const S: TemplateStringsArray = tagc27\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	28(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	29(S: TemplateStringsArray): string { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	30(): string { const S: TemplateStringsArray = tagc30\`\\unicode\${1}b\${2}c\`; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	31(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	32(S: TemplateStringsArray): string { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	33(): string { const S: TemplateStringsArray = tagc33\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	34(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	35(S: TemplateStringsArray): string { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
36(): string { const S: TemplateStringsArray = tagc36\`\\unicode\${1}b\${2}c\`; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	37(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	38(S: TemplateStringsArray): string { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	39(): string { const S: TemplateStringsArray = tagc39\`\\unicode\${1}b\${2}c\`; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	40(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S: TemplateStringsArray): string { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42(): string { const S: TemplateStringsArray = tagc42\`\\unicode\${1}b\${2}c\`; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	43(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	44(S: TemplateStringsArray): string { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t
45(): string { const S: TemplateStringsArray = tagc45\`\\unicode\${1}b\${2}c\`; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	46(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	47(S: TemplateStringsArray): string { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	48(): string { const S: TemplateStringsArray = tagc48\`\\unicode\${1}b\${2}c\`; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	49(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	50(S: TemplateStringsArray): string { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	51(): string { const S: TemplateStringsArray = tagc51\`\\unicode\${1}b\${2}c\`; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	52(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	53(S: TemplateStringsArray): string { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])
54(): string { const S: TemplateStringsArray = tagc54\`\\unicode\${1}b\${2}c\`; return S.join("+") + "|" + S.join()	55(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.join("+") + "|" + S.join()	56(S: TemplateStringsArray): string { return S.join("+") + "|" + S.join()	57(): string { const S: TemplateStringsArray = tagc57\`\\unicode\${1}b\${2}c\`; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	58(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	59(S: TemplateStringsArray): string { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	60(): string { const S: TemplateStringsArray = tagc60\`\\unicode\${1}b\${2}c\`; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(S: TemplateStringsArray): string { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
63(): string { const S: TemplateStringsArray = tagc63\`\\unicode\${1}b\${2}c\`; return S.map(p => p + p).join()	64(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.map(p => p + p).join()	65(S: TemplateStringsArray): string { return S.map(p => p + p).join()	66(): string { const S: TemplateStringsArray = tagc66\`\\unicode\${1}b\${2}c\`; return S.map(p => typeof p).join()	67(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.map(p => typeof p).join()	68(S: TemplateStringsArray): string { return S.map(p => typeof p).join()	69(): string { const S: TemplateStringsArray = tagc69\`\\unicode\${1}b\${2}c\`; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	70(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	71(S: TemplateStringsArray): string { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
72(): string { const S: TemplateStringsArray = tagc72\`\\unicode\${1}b\${2}c\`; return S.reduce((t, p, i) => t + typeof p + p + i, "")	73(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.reduce((t, p, i) => t + typeof p + p + i, "")	74(S: TemplateStringsArray): string { return S.reduce((t, p, i) => t + typeof p + p + i, "")	75(): string { const S: TemplateStringsArray = tagc75\`\\unicode\${1}b\${2}c\`; const r = S.reduce((a, b) => a); return typeof r + ":" + r	76(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.reduce((a, b) => a); return typeof r + ":" + r	77(S: TemplateStringsArray): string { const r = S.reduce((a, b) => a); return typeof r + ":" + r	78(): string { const S: TemplateStringsArray = tagc78\`\\unicode\${1}b\${2}c\`; return S.reduceRight((t, p) => t + typeof p + p, "")	79(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.reduceRight((t, p) => t + typeof p + p, "")	80(S: TemplateStringsArray): string { return S.reduceRight((t, p) => t + typeof p + p, "")
81(): string { const S: TemplateStringsArray = tagc81\`\\unicode\${1}b\${2}c\`; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	82(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	83(S: TemplateStringsArray): string { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	84(): string { const S: TemplateStringsArray = tagc84\`\\unicode\${1}b\${2}c\`; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	85(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	86(S: TemplateStringsArray): string { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	87(): string { const S: TemplateStringsArray = tagc87\`\\unicode\${1}b\${2}c\`; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	88(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	89(S: TemplateStringsArray): string { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t
90(): string { const S: TemplateStringsArray = tagc90\`\\unicode\${1}b\${2}c\`; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(S: TemplateStringsArray): string { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	93(): string { const S: TemplateStringsArray = tagc93\`\\unicode\${1}b\${2}c\`; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	94(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	95(S: TemplateStringsArray): string { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	96(): string { const S: any = tagc96\`\\unicode\${1}b\${2}c\`; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(S: any): string { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
99(): string { const S: any = tagc99\`\\unicode\${1}b\${2}c\`; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	100(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	101(S: any): string { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	102(): string { const S: TemplateStringsArray = tagc102\`\\unicode\${1}b\${2}c\`; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	103(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	104(S: TemplateStringsArray): string { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	105(): string { const S: TemplateStringsArray = tagc105\`\\unicode\${1}b\${2}c\`; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	106(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	107(S: TemplateStringsArray): string { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
108(): string { const S: TemplateStringsArray = tagc108\`\\unicode\${1}b\${2}c\`; let t = ""; for (const p of S) t += typeof p + p + ","; return t	109(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const p of S) t += typeof p + p + ","; return t	110(S: TemplateStringsArray): string { let t = ""; for (const p of S) t += typeof p + p + ","; return t	111(): string { const S: TemplateStringsArray = tagc111\`\\unicode\${1}b\${2}c\`; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	112(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	113(S: TemplateStringsArray): string { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	114(): string { const S: TemplateStringsArray = tagc114\`\\unicode\${1}b\${2}c\`; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	115(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	116(S: TemplateStringsArray): string { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t
117(): string { const S: TemplateStringsArray = tagc117\`\\unicode\${1}b\${2}c\`; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	118(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	119(S: TemplateStringsArray): string { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	120(): string { const S: TemplateStringsArray = tagc120\`\\unicode\${1}b\${2}c\`; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	121(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	122(S: TemplateStringsArray): string { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	123(): string { const S: TemplateStringsArray = tagc123\`\\unicode\${1}b\${2}c\`; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	124(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	125(S: TemplateStringsArray): string { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)
126(): string { const S: TemplateStringsArray = tagc126\`\\unicode\${1}b\${2}c\`; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	127(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	128(S: TemplateStringsArray): string { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	129(): string { const S: TemplateStringsArray = tagc129\`\\unicode\${1}b\${2}c\`; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	130(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	131(S: TemplateStringsArray): string { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	132(): string { const S: TemplateStringsArray = tagc132\`\\unicode\${1}b\${2}c\`; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	133(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	134(S: TemplateStringsArray): string { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
135(): string { const S: TemplateStringsArray = tagc135\`\\unicode\${1}b\${2}c\`; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	136(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	137(S: TemplateStringsArray): string { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	138(): string { const S: TemplateStringsArray = tagc138\`\\unicode\${1}b\${2}c\`; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	139(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	140(S: TemplateStringsArray): string { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	141(): string { const S: TemplateStringsArray = tagc141\`\\unicode\${1}b\${2}c\`; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	142(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	143(S: TemplateStringsArray): string { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
144(): string { const S: TemplateStringsArray = tagc144\`\\unicode\${1}b\${2}c\`; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	145(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	146(S: TemplateStringsArray): string { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	147(): string { const S: TemplateStringsArray = tagc147\`\\unicode\${1}b\${2}c\`; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	148(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	149(S: TemplateStringsArray): string { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	150(): string { const S: TemplateStringsArray = tagc150\`\\unicode\${1}b\${2}c\`; return JSON.stringify(S)	151(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return JSON.stringify(S)	152(S: TemplateStringsArray): string { return JSON.stringify(S)
153(): string { const S: TemplateStringsArray = tagc153\`\\unicode\${1}b\${2}c\`; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	154(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	155(S: TemplateStringsArray): string { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	156(): string { const S: TemplateStringsArray = tagc156\`\\unicode\${1}b\${2}c\`; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	157(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	158(S: TemplateStringsArray): string { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	159(): string { const S: TemplateStringsArray = tagc159\`\\unicode\${1}b\${2}c\`; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	160(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	161(S: TemplateStringsArray): string { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
162(): string { const S: TemplateStringsArray = tagc162\`\\unicode\${1}b\${2}c\`; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	163(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	164(S: TemplateStringsArray): string { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	165(): string { const S: any = tagc165\`\\unicode\${1}b\${2}c\`; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	166(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	167(S: any): string { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	168(): string { const S: any = tagc168\`\\unicode\${1}b\${2}c\`; return String.raw({ raw: S }, 1, 2)	169(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return String.raw({ raw: S }, 1, 2)	170(S: any): string { return String.raw({ raw: S }, 1, 2)
171(): string { const S: TemplateStringsArray = tagc171\`\\unicode\${1}b\${2}c\`; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	172(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	173(S: TemplateStringsArray): string { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	174(): string { const S: TemplateStringsArray = tagc174\`\\unicode\${1}b\${2}c\`; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	175(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	176(S: TemplateStringsArray): string { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	177(): string { const S: TemplateStringsArray = tagc177\`\\unicode\${1}b\${2}c\`; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	178(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	179(S: TemplateStringsArray): string { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
180(): string { const S: any = tagc180\`\\unicode\${1}b\${2}c\`; S.push("x"); return "pushed"	181(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; S.push("x"); return "pushed"	182(S: any): string { S.push("x"); return "pushed"	183(): string { const S: any = tagc183\`\\unicode\${1}b\${2}c\`; return "popped " + S.pop()	184(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return "popped " + S.pop()	185(S: any): string { return "popped " + S.pop()	186(): string { const S: any = tagc186\`\\unicode\${1}b\${2}c\`; return "shifted " + S.shift()	187(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return "shifted " + S.shift()	188(S: any): string { return "shifted " + S.shift()
189(): string { const S: any = tagc189\`\\unicode\${1}b\${2}c\`; S.unshift("x"); return "unshifted"	190(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; S.unshift("x"); return "unshifted"	191(S: any): string { S.unshift("x"); return "unshifted"	192(): string { const S: any = tagc192\`\\unicode\${1}b\${2}c\`; return show(S.reverse())	193(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.reverse())	194(S: any): string { return show(S.reverse())	195(): string { const S: any = tagc195\`\\unicode\${1}b\${2}c\`; return show(S.sort())	196(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.sort())	197(S: any): string { return show(S.sort())
198(): string { const S: any = tagc198\`\\unicode\${1}b\${2}c\`; return show(S.splice(0, 1))	199(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.splice(0, 1))	200(S: any): string { return show(S.splice(0, 1))	201(): string { const S: any = tagc201\`\\unicode\${1}b\${2}c\`; return show(S.fill("f"))	202(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.fill("f"))	203(S: any): string { return show(S.fill("f"))	204(): string { const S: any = tagc204\`\\unicode\${1}b\${2}c\`; return show(S.copyWithin(0, 1))	205(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.copyWithin(0, 1))	206(S: any): string { return show(S.copyWithin(0, 1))
207(): string { const S: any = tagc207\`\\unicode\${1}b\${2}c\`; "use strict"; S[0] = "x"; return "stored"	208(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; "use strict"; S[0] = "x"; return "stored"	209(S: any): string { "use strict"; S[0] = "x"; return "stored"	210(): string { const S: any = tagc210\`\\unicode\${1}b\${2}c\`; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	211(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	212(S: any): string { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	213(): string { const S: any = tagc213\`\\unicode\${1}b\${2}c\`; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	214(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	215(S: any): string { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (
          n,
          a,
          b,
          c,
          d,
          e,
          f,
          g,
          h,
          i,
        ) => `const tagc${9 * n} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${a}; }
function inc${b}; }
function c${9 * n + 1}(): string { return inc${9 * n + 1}\`\\unicode\${1}b\${2}c\`; }
const tagc${9 * n + 2} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${c}; }
function c${9 * n + 2}(): string { return hc${9 * n + 2}(tagc${9 * n + 2}\`\\unicode\${1}b\${2}c\`); }
const tagc${9 * n + 3} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${d}; }
function inc${e}; }
function c${9 * n + 4}(): string { return inc${9 * n + 4}\`\\unicode\${1}b\${2}c\`; }
const tagc${9 * n + 5} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${f}; }
function c${9 * n + 5}(): string { return hc${9 * n + 5}(tagc${9 * n + 5}\`\\unicode\${1}b\${2}c\`); }
const tagc${9 * n + 6} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${g}; }
function inc${h}; }
function c${9 * n + 7}(): string { return inc${9 * n + 7}\`\\unicode\${1}b\${2}c\`; }
const tagc${9 * n + 8} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${i}; }
function c${9 * n + 8}(): string { return hc${9 * n + 8}(tagc${9 * n + 8}\`\\unicode\${1}b\${2}c\`); }`,
      ],
      `const cases: [string, () => string][] = [["at here", c0], ["at in-tag", c1], ["at helper", c2], ["concat here", c3], ["concat in-tag", c4], ["concat helper", c5], ["concat-more here", c6], ["concat-more in-tag", c7], ["concat-more helper", c8], ["concat-onto here", c9], ["concat-onto in-tag", c10], ["concat-onto helper", c11], ["entries here", c12], ["entries in-tag", c13], ["entries helper", c14], ["every here", c15], ["every in-tag", c16], ["every helper", c17], ["filter here", c18], ["filter in-tag", c19], ["filter helper", c20], ["filter-length here", c21], ["filter-length in-tag", c22], ["filter-length helper", c23], ["find here", c24], ["find in-tag", c25], ["find helper", c26], ["findIndex here", c27], ["findIndex in-tag", c28], ["findIndex helper", c29], ["findLast here", c30], ["findLast in-tag", c31], ["findLast helper", c32], ["findLastIndex here", c33], ["findLastIndex in-tag", c34], ["findLastIndex helper", c35], ["flat here", c36], ["flat in-tag", c37], ["flat helper", c38], ["flatMap here", c39], ["flatMap in-tag", c40], ["flatMap helper", c41], ["forEach here", c42], ["forEach in-tag", c43], ["forEach helper", c44], ["forEach-method here", c45], ["forEach-method in-tag", c46], ["forEach-method helper", c47], ["includes here", c48], ["includes in-tag", c49], ["includes helper", c50], ["indexOf here", c51], ["indexOf in-tag", c52], ["indexOf helper", c53], ["join here", c54], ["join in-tag", c55], ["join helper", c56], ["keys here", c57], ["keys in-tag", c58], ["keys helper", c59], ["map here", c60], ["map in-tag", c61], ["map helper", c62], ["map-join here", c63], ["map-join in-tag", c64], ["map-join helper", c65], ["map-typeof here", c66], ["map-typeof in-tag", c67], ["map-typeof helper", c68], ["map-index here", c69], ["map-index in-tag", c70], ["map-index helper", c71], ["reduce here", c72], ["reduce in-tag", c73], ["reduce helper", c74], ["reduce-first here", c75], ["reduce-first in-tag", c76], ["reduce-first helper", c77], ["reduceRight here", c78], ["reduceRight in-tag", c79], ["reduceRight helper", c80], ["slice here", c81], ["slice in-tag", c82], ["slice helper", c83], ["slice-1 here", c84], ["slice-1 in-tag", c85], ["slice-1 helper", c86], ["some here", c87], ["some in-tag", c88], ["some helper", c89], ["toReversed here", c90], ["toReversed in-tag", c91], ["toReversed helper", c92], ["toSorted here", c93], ["toSorted in-tag", c94], ["toSorted helper", c95], ["toSpliced here", c96], ["toSpliced in-tag", c97], ["toSpliced helper", c98], ["with here", c99], ["with in-tag", c100], ["with helper", c101], ["toString here", c102], ["toString in-tag", c103], ["toString helper", c104], ["values here", c105], ["values in-tag", c106], ["values helper", c107], ["for-of here", c108], ["for-of in-tag", c109], ["for-of helper", c110], ["for-in here", c111], ["for-in in-tag", c112], ["for-in helper", c113], ["index-loop here", c114], ["index-loop in-tag", c115], ["index-loop helper", c116], ["spread here", c117], ["spread in-tag", c118], ["spread helper", c119], ["spread-call here", c120], ["spread-call in-tag", c121], ["spread-call helper", c122], ["destructure here", c123], ["destructure in-tag", c124], ["destructure helper", c125], ["Array.from here", c126], ["Array.from in-tag", c127], ["Array.from helper", c128], ["Array.from-map here", c129], ["Array.from-map in-tag", c130], ["Array.from-map helper", c131], ["Array.of here", c132], ["Array.of in-tag", c133], ["Array.of helper", c134], ["Object.values here", c135], ["Object.values in-tag", c136], ["Object.values helper", c137], ["Object.entries here", c138], ["Object.entries in-tag", c139], ["Object.entries helper", c140], ["Object.keys here", c141], ["Object.keys in-tag", c142], ["Object.keys helper", c143], ["Object.assign here", c144], ["Object.assign in-tag", c145], ["Object.assign helper", c146], ["object-spread here", c147], ["object-spread in-tag", c148], ["object-spread helper", c149], ["JSON here", c150], ["JSON in-tag", c151], ["JSON helper", c152], ["Set here", c153], ["Set in-tag", c154], ["Set helper", c155], ["Map here", c156], ["Map in-tag", c157], ["Map helper", c158], ["call-map here", c159], ["call-map in-tag", c160], ["call-map helper", c161], ["call-slice here", c162], ["call-slice in-tag", c163], ["call-slice helper", c164], ["apply here", c165], ["apply in-tag", c166], ["apply helper", c167], ["String.raw here", c168], ["String.raw in-tag", c169], ["String.raw helper", c170], ["structuredClone here", c171], ["structuredClone in-tag", c172], ["structuredClone helper", c173], ["isArray here", c174], ["isArray in-tag", c175], ["isArray helper", c176], ["descriptor here", c177], ["descriptor in-tag", c178], ["descriptor helper", c179], ["push here", c180], ["push in-tag", c181], ["push helper", c182], ["pop here", c183], ["pop in-tag", c184], ["pop helper", c185], ["shift here", c186], ["shift in-tag", c187], ["shift helper", c188], ["unshift here", c189], ["unshift in-tag", c190], ["unshift helper", c191], ["reverse here", c192], ["reverse in-tag", c193], ["reverse helper", c194], ["sort here", c195], ["sort in-tag", c196], ["sort helper", c197], ["splice here", c198], ["splice in-tag", c199], ["splice helper", c200], ["fill here", c201], ["fill in-tag", c202], ["fill helper", c203], ["copyWithin here", c204], ["copyWithin in-tag", c205], ["copyWithin helper", c206], ["store here", c207], ["store in-tag", c208], ["store helper", c209], ["chain here", c210], ["chain in-tag", c211], ["chain helper", c212], ["then-read here", c213], ["then-read in-tag", c214], ["then-read helper", c215]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e as any).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-the-strings-of-a-tagged-template.js": text(
      `// Every method of Array.prototype, and what else reads a list, on the strings of a tagged template: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
function show(v) {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0() { const S = tagc0\`a\${1}b\${2}c\`; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(strings, ...rest) { const S = strings; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(S) { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	3() { const S = tagc3\`a\${1}b\${2}c\`; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(strings, ...rest) { const S = strings; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S) { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6() { const S = tagc6\`a\${1}b\${2}c\`; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(strings, ...rest) { const S = strings; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	8(S) { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
9() { const S = tagc9\`a\${1}b\${2}c\`; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	10(strings, ...rest) { const S = strings; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	11(S) { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	12() { const S = tagc12\`a\${1}b\${2}c\`; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	13(strings, ...rest) { const S = strings; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	14(S) { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	15() { const S = tagc15\`a\${1}b\${2}c\`; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	16(strings, ...rest) { const S = strings; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	17(S) { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t
18() { const S = tagc18\`a\${1}b\${2}c\`; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	19(strings, ...rest) { const S = strings; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	20(S) { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	21() { const S = tagc21\`a\${1}b\${2}c\`; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	22(strings, ...rest) { const S = strings; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	23(S) { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	24() { const S = tagc24\`a\${1}b\${2}c\`; const r = S.find(p => p !== undefined); return typeof r + ":" + r	25(strings, ...rest) { const S = strings; const r = S.find(p => p !== undefined); return typeof r + ":" + r	26(S) { const r = S.find(p => p !== undefined); return typeof r + ":" + r
27() { const S = tagc27\`a\${1}b\${2}c\`; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	28(strings, ...rest) { const S = strings; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	29(S) { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	30() { const S = tagc30\`a\${1}b\${2}c\`; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	31(strings, ...rest) { const S = strings; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	32(S) { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	33() { const S = tagc33\`a\${1}b\${2}c\`; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	34(strings, ...rest) { const S = strings; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	35(S) { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
36() { const S = tagc36\`a\${1}b\${2}c\`; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	37(strings, ...rest) { const S = strings; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	38(S) { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	39() { const S = tagc39\`a\${1}b\${2}c\`; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	40(strings, ...rest) { const S = strings; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S) { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42() { const S = tagc42\`a\${1}b\${2}c\`; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	43(strings, ...rest) { const S = strings; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	44(S) { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t
45() { const S = tagc45\`a\${1}b\${2}c\`; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	46(strings, ...rest) { const S = strings; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	47(S) { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	48() { const S = tagc48\`a\${1}b\${2}c\`; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	49(strings, ...rest) { const S = strings; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	50(S) { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	51() { const S = tagc51\`a\${1}b\${2}c\`; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	52(strings, ...rest) { const S = strings; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	53(S) { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])
54() { const S = tagc54\`a\${1}b\${2}c\`; return S.join("+") + "|" + S.join()	55(strings, ...rest) { const S = strings; return S.join("+") + "|" + S.join()	56(S) { return S.join("+") + "|" + S.join()	57() { const S = tagc57\`a\${1}b\${2}c\`; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	58(strings, ...rest) { const S = strings; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	59(S) { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	60() { const S = tagc60\`a\${1}b\${2}c\`; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(strings, ...rest) { const S = strings; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(S) { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
63() { const S = tagc63\`a\${1}b\${2}c\`; return S.map(p => p + p).join()	64(strings, ...rest) { const S = strings; return S.map(p => p + p).join()	65(S) { return S.map(p => p + p).join()	66() { const S = tagc66\`a\${1}b\${2}c\`; return S.map(p => typeof p).join()	67(strings, ...rest) { const S = strings; return S.map(p => typeof p).join()	68(S) { return S.map(p => typeof p).join()	69() { const S = tagc69\`a\${1}b\${2}c\`; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	70(strings, ...rest) { const S = strings; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	71(S) { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
72() { const S = tagc72\`a\${1}b\${2}c\`; return S.reduce((t, p, i) => t + typeof p + p + i, "")	73(strings, ...rest) { const S = strings; return S.reduce((t, p, i) => t + typeof p + p + i, "")	74(S) { return S.reduce((t, p, i) => t + typeof p + p + i, "")	75() { const S = tagc75\`a\${1}b\${2}c\`; const r = S.reduce((a, b) => a); return typeof r + ":" + r	76(strings, ...rest) { const S = strings; const r = S.reduce((a, b) => a); return typeof r + ":" + r	77(S) { const r = S.reduce((a, b) => a); return typeof r + ":" + r	78() { const S = tagc78\`a\${1}b\${2}c\`; return S.reduceRight((t, p) => t + typeof p + p, "")	79(strings, ...rest) { const S = strings; return S.reduceRight((t, p) => t + typeof p + p, "")	80(S) { return S.reduceRight((t, p) => t + typeof p + p, "")
81() { const S = tagc81\`a\${1}b\${2}c\`; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	82(strings, ...rest) { const S = strings; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	83(S) { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	84() { const S = tagc84\`a\${1}b\${2}c\`; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	85(strings, ...rest) { const S = strings; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	86(S) { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	87() { const S = tagc87\`a\${1}b\${2}c\`; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	88(strings, ...rest) { const S = strings; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	89(S) { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t
90() { const S = tagc90\`a\${1}b\${2}c\`; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(strings, ...rest) { const S = strings; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(S) { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	93() { const S = tagc93\`a\${1}b\${2}c\`; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	94(strings, ...rest) { const S = strings; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	95(S) { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	96() { const S = tagc96\`a\${1}b\${2}c\`; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(strings, ...rest) { const S = strings; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(S) { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
99() { const S = tagc99\`a\${1}b\${2}c\`; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	100(strings, ...rest) { const S = strings; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	101(S) { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	102() { const S = tagc102\`a\${1}b\${2}c\`; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	103(strings, ...rest) { const S = strings; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	104(S) { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	105() { const S = tagc105\`a\${1}b\${2}c\`; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	106(strings, ...rest) { const S = strings; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	107(S) { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
108() { const S = tagc108\`a\${1}b\${2}c\`; let t = ""; for (const p of S) t += typeof p + p + ","; return t	109(strings, ...rest) { const S = strings; let t = ""; for (const p of S) t += typeof p + p + ","; return t	110(S) { let t = ""; for (const p of S) t += typeof p + p + ","; return t	111() { const S = tagc111\`a\${1}b\${2}c\`; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	112(strings, ...rest) { const S = strings; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	113(S) { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	114() { const S = tagc114\`a\${1}b\${2}c\`; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	115(strings, ...rest) { const S = strings; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	116(S) { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t
117() { const S = tagc117\`a\${1}b\${2}c\`; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	118(strings, ...rest) { const S = strings; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	119(S) { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	120() { const S = tagc120\`a\${1}b\${2}c\`; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	121(strings, ...rest) { const S = strings; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	122(S) { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	123() { const S = tagc123\`a\${1}b\${2}c\`; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	124(strings, ...rest) { const S = strings; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	125(S) { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)
126() { const S = tagc126\`a\${1}b\${2}c\`; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	127(strings, ...rest) { const S = strings; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	128(S) { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	129() { const S = tagc129\`a\${1}b\${2}c\`; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	130(strings, ...rest) { const S = strings; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	131(S) { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	132() { const S = tagc132\`a\${1}b\${2}c\`; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	133(strings, ...rest) { const S = strings; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	134(S) { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
135() { const S = tagc135\`a\${1}b\${2}c\`; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	136(strings, ...rest) { const S = strings; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	137(S) { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	138() { const S = tagc138\`a\${1}b\${2}c\`; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	139(strings, ...rest) { const S = strings; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	140(S) { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	141() { const S = tagc141\`a\${1}b\${2}c\`; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	142(strings, ...rest) { const S = strings; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	143(S) { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
144() { const S = tagc144\`a\${1}b\${2}c\`; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	145(strings, ...rest) { const S = strings; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	146(S) { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	147() { const S = tagc147\`a\${1}b\${2}c\`; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	148(strings, ...rest) { const S = strings; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	149(S) { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	150() { const S = tagc150\`a\${1}b\${2}c\`; return JSON.stringify(S)	151(strings, ...rest) { const S = strings; return JSON.stringify(S)	152(S) { return JSON.stringify(S)
153() { const S = tagc153\`a\${1}b\${2}c\`; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	154(strings, ...rest) { const S = strings; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	155(S) { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	156() { const S = tagc156\`a\${1}b\${2}c\`; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	157(strings, ...rest) { const S = strings; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	158(S) { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	159() { const S = tagc159\`a\${1}b\${2}c\`; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	160(strings, ...rest) { const S = strings; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	161(S) { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
162() { const S = tagc162\`a\${1}b\${2}c\`; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	163(strings, ...rest) { const S = strings; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	164(S) { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	165() { const S = tagc165\`a\${1}b\${2}c\`; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	166(strings, ...rest) { const S = strings; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	167(S) { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	168() { const S = tagc168\`a\${1}b\${2}c\`; return String.raw({ raw: S }, 1, 2)	169(strings, ...rest) { const S = strings; return String.raw({ raw: S }, 1, 2)	170(S) { return String.raw({ raw: S }, 1, 2)
171() { const S = tagc171\`a\${1}b\${2}c\`; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	172(strings, ...rest) { const S = strings; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	173(S) { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	174() { const S = tagc174\`a\${1}b\${2}c\`; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	175(strings, ...rest) { const S = strings; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	176(S) { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	177() { const S = tagc177\`a\${1}b\${2}c\`; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	178(strings, ...rest) { const S = strings; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	179(S) { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
180() { const S = tagc180\`a\${1}b\${2}c\`; S.push("x"); return "pushed"	181(strings, ...rest) { const S = strings; S.push("x"); return "pushed"	182(S) { S.push("x"); return "pushed"	183() { const S = tagc183\`a\${1}b\${2}c\`; return "popped " + S.pop()	184(strings, ...rest) { const S = strings; return "popped " + S.pop()	185(S) { return "popped " + S.pop()	186() { const S = tagc186\`a\${1}b\${2}c\`; return "shifted " + S.shift()	187(strings, ...rest) { const S = strings; return "shifted " + S.shift()	188(S) { return "shifted " + S.shift()
189() { const S = tagc189\`a\${1}b\${2}c\`; S.unshift("x"); return "unshifted"	190(strings, ...rest) { const S = strings; S.unshift("x"); return "unshifted"	191(S) { S.unshift("x"); return "unshifted"	192() { const S = tagc192\`a\${1}b\${2}c\`; return show(S.reverse())	193(strings, ...rest) { const S = strings; return show(S.reverse())	194(S) { return show(S.reverse())	195() { const S = tagc195\`a\${1}b\${2}c\`; return show(S.sort())	196(strings, ...rest) { const S = strings; return show(S.sort())	197(S) { return show(S.sort())
198() { const S = tagc198\`a\${1}b\${2}c\`; return show(S.splice(0, 1))	199(strings, ...rest) { const S = strings; return show(S.splice(0, 1))	200(S) { return show(S.splice(0, 1))	201() { const S = tagc201\`a\${1}b\${2}c\`; return show(S.fill("f"))	202(strings, ...rest) { const S = strings; return show(S.fill("f"))	203(S) { return show(S.fill("f"))	204() { const S = tagc204\`a\${1}b\${2}c\`; return show(S.copyWithin(0, 1))	205(strings, ...rest) { const S = strings; return show(S.copyWithin(0, 1))	206(S) { return show(S.copyWithin(0, 1))
207() { const S = tagc207\`a\${1}b\${2}c\`; "use strict"; S[0] = "x"; return "stored"	208(strings, ...rest) { const S = strings; "use strict"; S[0] = "x"; return "stored"	209(S) { "use strict"; S[0] = "x"; return "stored"	210() { const S = tagc210\`a\${1}b\${2}c\`; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	211(strings, ...rest) { const S = strings; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	212(S) { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	213() { const S = tagc213\`a\${1}b\${2}c\`; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	214(strings, ...rest) { const S = strings; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	215(S) { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (n, a, b, c, d, e, f, g, h, i) => `const tagc${9 * n} = (strings, ...rest) => strings;
function c${a}; }
function inc${b}; }
function c${9 * n + 1}() { return inc${9 * n + 1}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 2} = (strings, ...rest) => strings;
function hc${c}; }
function c${9 * n + 2}() { return hc${9 * n + 2}(tagc${9 * n + 2}\`a\${1}b\${2}c\`); }
const tagc${9 * n + 3} = (strings, ...rest) => strings;
function c${d}; }
function inc${e}; }
function c${9 * n + 4}() { return inc${9 * n + 4}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 5} = (strings, ...rest) => strings;
function hc${f}; }
function c${9 * n + 5}() { return hc${9 * n + 5}(tagc${9 * n + 5}\`a\${1}b\${2}c\`); }
const tagc${9 * n + 6} = (strings, ...rest) => strings;
function c${g}; }
function inc${h}; }
function c${9 * n + 7}() { return inc${9 * n + 7}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 8} = (strings, ...rest) => strings;
function hc${i}; }
function c${9 * n + 8}() { return hc${9 * n + 8}(tagc${9 * n + 8}\`a\${1}b\${2}c\`); }`,
      ],
      `const cases = [["at here", c0], ["at in-tag", c1], ["at helper", c2], ["concat here", c3], ["concat in-tag", c4], ["concat helper", c5], ["concat-more here", c6], ["concat-more in-tag", c7], ["concat-more helper", c8], ["concat-onto here", c9], ["concat-onto in-tag", c10], ["concat-onto helper", c11], ["entries here", c12], ["entries in-tag", c13], ["entries helper", c14], ["every here", c15], ["every in-tag", c16], ["every helper", c17], ["filter here", c18], ["filter in-tag", c19], ["filter helper", c20], ["filter-length here", c21], ["filter-length in-tag", c22], ["filter-length helper", c23], ["find here", c24], ["find in-tag", c25], ["find helper", c26], ["findIndex here", c27], ["findIndex in-tag", c28], ["findIndex helper", c29], ["findLast here", c30], ["findLast in-tag", c31], ["findLast helper", c32], ["findLastIndex here", c33], ["findLastIndex in-tag", c34], ["findLastIndex helper", c35], ["flat here", c36], ["flat in-tag", c37], ["flat helper", c38], ["flatMap here", c39], ["flatMap in-tag", c40], ["flatMap helper", c41], ["forEach here", c42], ["forEach in-tag", c43], ["forEach helper", c44], ["forEach-method here", c45], ["forEach-method in-tag", c46], ["forEach-method helper", c47], ["includes here", c48], ["includes in-tag", c49], ["includes helper", c50], ["indexOf here", c51], ["indexOf in-tag", c52], ["indexOf helper", c53], ["join here", c54], ["join in-tag", c55], ["join helper", c56], ["keys here", c57], ["keys in-tag", c58], ["keys helper", c59], ["map here", c60], ["map in-tag", c61], ["map helper", c62], ["map-join here", c63], ["map-join in-tag", c64], ["map-join helper", c65], ["map-typeof here", c66], ["map-typeof in-tag", c67], ["map-typeof helper", c68], ["map-index here", c69], ["map-index in-tag", c70], ["map-index helper", c71], ["reduce here", c72], ["reduce in-tag", c73], ["reduce helper", c74], ["reduce-first here", c75], ["reduce-first in-tag", c76], ["reduce-first helper", c77], ["reduceRight here", c78], ["reduceRight in-tag", c79], ["reduceRight helper", c80], ["slice here", c81], ["slice in-tag", c82], ["slice helper", c83], ["slice-1 here", c84], ["slice-1 in-tag", c85], ["slice-1 helper", c86], ["some here", c87], ["some in-tag", c88], ["some helper", c89], ["toReversed here", c90], ["toReversed in-tag", c91], ["toReversed helper", c92], ["toSorted here", c93], ["toSorted in-tag", c94], ["toSorted helper", c95], ["toSpliced here", c96], ["toSpliced in-tag", c97], ["toSpliced helper", c98], ["with here", c99], ["with in-tag", c100], ["with helper", c101], ["toString here", c102], ["toString in-tag", c103], ["toString helper", c104], ["values here", c105], ["values in-tag", c106], ["values helper", c107], ["for-of here", c108], ["for-of in-tag", c109], ["for-of helper", c110], ["for-in here", c111], ["for-in in-tag", c112], ["for-in helper", c113], ["index-loop here", c114], ["index-loop in-tag", c115], ["index-loop helper", c116], ["spread here", c117], ["spread in-tag", c118], ["spread helper", c119], ["spread-call here", c120], ["spread-call in-tag", c121], ["spread-call helper", c122], ["destructure here", c123], ["destructure in-tag", c124], ["destructure helper", c125], ["Array.from here", c126], ["Array.from in-tag", c127], ["Array.from helper", c128], ["Array.from-map here", c129], ["Array.from-map in-tag", c130], ["Array.from-map helper", c131], ["Array.of here", c132], ["Array.of in-tag", c133], ["Array.of helper", c134], ["Object.values here", c135], ["Object.values in-tag", c136], ["Object.values helper", c137], ["Object.entries here", c138], ["Object.entries in-tag", c139], ["Object.entries helper", c140], ["Object.keys here", c141], ["Object.keys in-tag", c142], ["Object.keys helper", c143], ["Object.assign here", c144], ["Object.assign in-tag", c145], ["Object.assign helper", c146], ["object-spread here", c147], ["object-spread in-tag", c148], ["object-spread helper", c149], ["JSON here", c150], ["JSON in-tag", c151], ["JSON helper", c152], ["Set here", c153], ["Set in-tag", c154], ["Set helper", c155], ["Map here", c156], ["Map in-tag", c157], ["Map helper", c158], ["call-map here", c159], ["call-map in-tag", c160], ["call-map helper", c161], ["call-slice here", c162], ["call-slice in-tag", c163], ["call-slice helper", c164], ["apply here", c165], ["apply in-tag", c166], ["apply helper", c167], ["String.raw here", c168], ["String.raw in-tag", c169], ["String.raw helper", c170], ["structuredClone here", c171], ["structuredClone in-tag", c172], ["structuredClone helper", c173], ["isArray here", c174], ["isArray in-tag", c175], ["isArray helper", c176], ["descriptor here", c177], ["descriptor in-tag", c178], ["descriptor helper", c179], ["push here", c180], ["push in-tag", c181], ["push helper", c182], ["pop here", c183], ["pop in-tag", c184], ["pop helper", c185], ["shift here", c186], ["shift in-tag", c187], ["shift helper", c188], ["unshift here", c189], ["unshift in-tag", c190], ["unshift helper", c191], ["reverse here", c192], ["reverse in-tag", c193], ["reverse helper", c194], ["sort here", c195], ["sort in-tag", c196], ["sort helper", c197], ["splice here", c198], ["splice in-tag", c199], ["splice helper", c200], ["fill here", c201], ["fill in-tag", c202], ["fill helper", c203], ["copyWithin here", c204], ["copyWithin in-tag", c205], ["copyWithin helper", c206], ["store here", c207], ["store in-tag", c208], ["store helper", c209], ["chain here", c210], ["chain in-tag", c211], ["chain helper", c212], ["then-read here", c213], ["then-read in-tag", c214], ["then-read helper", c215]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "every-array-method-on-the-strings-of-a-tagged-template.ts": text(
      `// Every method of Array.prototype, and what else reads a list, on the strings of a tagged template: where the list is made, inside the tag function, and through a helper.
// Each case has a function, a literal, a tag and a helper of its own. With a number as its argument the program runs that case alone.
// @ts-nocheck
function show(v: any): string {
  if (Array.isArray(v)) return "[" + Array.from(v, e => typeof e + ":" + String(e)).join(",") + "]#" + v.length;
  return typeof v + ":" + String(v);
}
`,
      [
        `0(): string { const S: TemplateStringsArray = tagc0\`a\${1}b\${2}c\`; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	1(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	2(S: TemplateStringsArray): string { const r = S.at(0), q = S.at(-1); return typeof r + ":" + r + "|" + typeof q + ":" + q	3(): string { const S: TemplateStringsArray = tagc3\`a\${1}b\${2}c\`; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	4(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	5(S: TemplateStringsArray): string { const r = S.concat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	6(): string { const S: any = tagc6\`a\${1}b\${2}c\`; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	7(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	8(S: any): string { const r = S.concat(S, ["z"]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
9(): string { const S: TemplateStringsArray = tagc9\`a\${1}b\${2}c\`; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	10(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	11(S: TemplateStringsArray): string { const r = ["z"].concat(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	12(): string { const S: TemplateStringsArray = tagc12\`a\${1}b\${2}c\`; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	13(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	14(S: TemplateStringsArray): string { let t = ""; for (const [i, p] of S.entries()) t += i + typeof p + p + ","; return t	15(): string { const S: TemplateStringsArray = tagc15\`a\${1}b\${2}c\`; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	16(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t	17(S: TemplateStringsArray): string { let t = ""; const r = S.every(p => { t += typeof p + p + ","; return true; }); return r + t
18(): string { const S: TemplateStringsArray = tagc18\`a\${1}b\${2}c\`; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	19(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	20(S: TemplateStringsArray): string { let t = ""; const r = S.filter(p => { t += typeof p + ","; return true; }); return t + typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	21(): string { const S: TemplateStringsArray = tagc21\`a\${1}b\${2}c\`; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	22(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	23(S: TemplateStringsArray): string { const r = S.filter(p => String(p).length > 0); return typeof r[0] + r.join("+")	24(): string { const S: TemplateStringsArray = tagc24\`a\${1}b\${2}c\`; const r = S.find(p => p !== undefined); return typeof r + ":" + r	25(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.find(p => p !== undefined); return typeof r + ":" + r	26(S: TemplateStringsArray): string { const r = S.find(p => p !== undefined); return typeof r + ":" + r
27(): string { const S: TemplateStringsArray = tagc27\`a\${1}b\${2}c\`; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	28(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	29(S: TemplateStringsArray): string { let t = ""; const r = S.findIndex(p => { t += typeof p; return false; }); return r + t	30(): string { const S: TemplateStringsArray = tagc30\`a\${1}b\${2}c\`; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	31(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	32(S: TemplateStringsArray): string { const r = S.findLast(p => p !== undefined); return typeof r + ":" + r	33(): string { const S: TemplateStringsArray = tagc33\`a\${1}b\${2}c\`; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	34(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t	35(S: TemplateStringsArray): string { let t = ""; const r = S.findLastIndex(p => { t += typeof p; return false; }); return r + t
36(): string { const S: TemplateStringsArray = tagc36\`a\${1}b\${2}c\`; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	37(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	38(S: TemplateStringsArray): string { const r = S.flat(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	39(): string { const S: TemplateStringsArray = tagc39\`a\${1}b\${2}c\`; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	40(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	41(S: TemplateStringsArray): string { const r = S.flatMap(p => [p, p]); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	42(): string { const S: TemplateStringsArray = tagc42\`a\${1}b\${2}c\`; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	43(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t	44(S: TemplateStringsArray): string { let t = ""; S.forEach((p, i) => { t += typeof p + ":" + p + i + ","; }); return t
45(): string { const S: TemplateStringsArray = tagc45\`a\${1}b\${2}c\`; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	46(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	47(S: TemplateStringsArray): string { let t = ""; S.forEach(p => { t += String(p).toUpperCase(); }); return t	48(): string { const S: TemplateStringsArray = tagc48\`a\${1}b\${2}c\`; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	49(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	50(S: TemplateStringsArray): string { return S.includes(S[0]) + "|" + S.includes(undefined) + "|" + S.includes("nothing")	51(): string { const S: TemplateStringsArray = tagc51\`a\${1}b\${2}c\`; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	52(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])	53(S: TemplateStringsArray): string { return S.indexOf(S[1]) + "|" + S.indexOf(undefined) + "|" + S.lastIndexOf(S[1])
54(): string { const S: TemplateStringsArray = tagc54\`a\${1}b\${2}c\`; return S.join("+") + "|" + S.join()	55(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.join("+") + "|" + S.join()	56(S: TemplateStringsArray): string { return S.join("+") + "|" + S.join()	57(): string { const S: TemplateStringsArray = tagc57\`a\${1}b\${2}c\`; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	58(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	59(S: TemplateStringsArray): string { let t = ""; for (const i of S.keys()) t += i + typeof S[i] + ","; return t	60(): string { const S: TemplateStringsArray = tagc60\`a\${1}b\${2}c\`; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	61(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	62(S: TemplateStringsArray): string { const r = S.map(p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
63(): string { const S: TemplateStringsArray = tagc63\`a\${1}b\${2}c\`; return S.map(p => p + p).join()	64(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.map(p => p + p).join()	65(S: TemplateStringsArray): string { return S.map(p => p + p).join()	66(): string { const S: TemplateStringsArray = tagc66\`a\${1}b\${2}c\`; return S.map(p => typeof p).join()	67(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.map(p => typeof p).join()	68(S: TemplateStringsArray): string { return S.map(p => typeof p).join()	69(): string { const S: TemplateStringsArray = tagc69\`a\${1}b\${2}c\`; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	70(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	71(S: TemplateStringsArray): string { const r = S.map((p, i, all) => all[i] === p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
72(): string { const S: TemplateStringsArray = tagc72\`a\${1}b\${2}c\`; return S.reduce((t, p, i) => t + typeof p + p + i, "")	73(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.reduce((t, p, i) => t + typeof p + p + i, "")	74(S: TemplateStringsArray): string { return S.reduce((t, p, i) => t + typeof p + p + i, "")	75(): string { const S: TemplateStringsArray = tagc75\`a\${1}b\${2}c\`; const r = S.reduce((a, b) => a); return typeof r + ":" + r	76(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.reduce((a, b) => a); return typeof r + ":" + r	77(S: TemplateStringsArray): string { const r = S.reduce((a, b) => a); return typeof r + ":" + r	78(): string { const S: TemplateStringsArray = tagc78\`a\${1}b\${2}c\`; return S.reduceRight((t, p) => t + typeof p + p, "")	79(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.reduceRight((t, p) => t + typeof p + p, "")	80(S: TemplateStringsArray): string { return S.reduceRight((t, p) => t + typeof p + p, "")
81(): string { const S: TemplateStringsArray = tagc81\`a\${1}b\${2}c\`; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	82(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	83(S: TemplateStringsArray): string { const r = S.slice(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	84(): string { const S: TemplateStringsArray = tagc84\`a\${1}b\${2}c\`; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	85(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	86(S: TemplateStringsArray): string { const r = S.slice(1); return typeof r[0] + ":" + r[0] + "!" + r.length	87(): string { const S: TemplateStringsArray = tagc87\`a\${1}b\${2}c\`; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	88(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t	89(S: TemplateStringsArray): string { let t = ""; const r = S.some(p => { t += typeof p + p; return false; }); return r + t
90(): string { const S: TemplateStringsArray = tagc90\`a\${1}b\${2}c\`; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	91(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	92(S: TemplateStringsArray): string { const r = S.toReversed(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	93(): string { const S: TemplateStringsArray = tagc93\`a\${1}b\${2}c\`; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	94(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	95(S: TemplateStringsArray): string { const r = S.toSorted(); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	96(): string { const S: any = tagc96\`a\${1}b\${2}c\`; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	97(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	98(S: any): string { const r = S.toSpliced(0, 1); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
99(): string { const S: any = tagc99\`a\${1}b\${2}c\`; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	100(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	101(S: any): string { const r = S.with(0, "w"); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	102(): string { const S: TemplateStringsArray = tagc102\`a\${1}b\${2}c\`; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	103(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	104(S: TemplateStringsArray): string { return S.toString() + "|" + S.toLocaleString() + "|" + String(S) + "|" + \`\${S}\` + "|" + (S + "")	105(): string { const S: TemplateStringsArray = tagc105\`a\${1}b\${2}c\`; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	106(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t	107(S: TemplateStringsArray): string { let t = ""; for (const p of S.values()) t += typeof p + p + ","; return t
108(): string { const S: TemplateStringsArray = tagc108\`a\${1}b\${2}c\`; let t = ""; for (const p of S) t += typeof p + p + ","; return t	109(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const p of S) t += typeof p + p + ","; return t	110(S: TemplateStringsArray): string { let t = ""; for (const p of S) t += typeof p + p + ","; return t	111(): string { const S: TemplateStringsArray = tagc111\`a\${1}b\${2}c\`; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	112(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	113(S: TemplateStringsArray): string { let t = ""; for (const k in S) t += k + typeof S[k] + ","; return t	114(): string { const S: TemplateStringsArray = tagc114\`a\${1}b\${2}c\`; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	115(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t	116(S: TemplateStringsArray): string { let t = ""; for (let i = 0; i < S.length; i++) t += typeof S[i] + S[i] + ","; return t
117(): string { const S: TemplateStringsArray = tagc117\`a\${1}b\${2}c\`; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	118(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	119(S: TemplateStringsArray): string { const r = [...S]; return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	120(): string { const S: TemplateStringsArray = tagc120\`a\${1}b\${2}c\`; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	121(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	122(S: TemplateStringsArray): string { const f = (a, b, c) => typeof a + a + typeof b + b + typeof c + c; return f(...S)	123(): string { const S: TemplateStringsArray = tagc123\`a\${1}b\${2}c\`; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	124(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)	125(S: TemplateStringsArray): string { const [a, b, ...c] = S; return typeof a + a + typeof b + b + show(c)
126(): string { const S: TemplateStringsArray = tagc126\`a\${1}b\${2}c\`; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	127(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	128(S: TemplateStringsArray): string { const r = Array.from(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	129(): string { const S: TemplateStringsArray = tagc129\`a\${1}b\${2}c\`; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	130(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	131(S: TemplateStringsArray): string { const r = Array.from(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	132(): string { const S: TemplateStringsArray = tagc132\`a\${1}b\${2}c\`; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	133(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	134(S: TemplateStringsArray): string { const r = Array.of(...S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
135(): string { const S: TemplateStringsArray = tagc135\`a\${1}b\${2}c\`; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	136(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	137(S: TemplateStringsArray): string { const r = Object.values(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	138(): string { const S: TemplateStringsArray = tagc138\`a\${1}b\${2}c\`; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	139(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	140(S: TemplateStringsArray): string { const r = Object.entries(S); return typeof r[0][1] + ":" + r[0][1] + "|" + r.length	141(): string { const S: TemplateStringsArray = tagc141\`a\${1}b\${2}c\`; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	142(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()	143(S: TemplateStringsArray): string { return Object.keys(S).join() + "|" + Object.getOwnPropertyNames(S).join()
144(): string { const S: TemplateStringsArray = tagc144\`a\${1}b\${2}c\`; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	145(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	146(S: TemplateStringsArray): string { const r = Object.assign([], S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	147(): string { const S: TemplateStringsArray = tagc147\`a\${1}b\${2}c\`; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	148(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	149(S: TemplateStringsArray): string { const r = { ...S }; return typeof r[0] + ":" + r[0] + "|" + Object.keys(r).join()	150(): string { const S: TemplateStringsArray = tagc150\`a\${1}b\${2}c\`; return JSON.stringify(S)	151(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return JSON.stringify(S)	152(S: TemplateStringsArray): string { return JSON.stringify(S)
153(): string { const S: TemplateStringsArray = tagc153\`a\${1}b\${2}c\`; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	154(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	155(S: TemplateStringsArray): string { const r = new Set(S); let t = ""; for (const p of r) t += typeof p + p; return r.size + t + r.has(S[0])	156(): string { const S: TemplateStringsArray = tagc156\`a\${1}b\${2}c\`; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	157(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	158(S: TemplateStringsArray): string { const r = new Map(S.map((p, i) => [p, i])); let t = ""; for (const [k, v] of r) t += typeof k + k + v; return r.size + t	159(): string { const S: TemplateStringsArray = tagc159\`a\${1}b\${2}c\`; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	160(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	161(S: TemplateStringsArray): string { const r = Array.prototype.map.call(S, p => p + p); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)
162(): string { const S: TemplateStringsArray = tagc162\`a\${1}b\${2}c\`; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	163(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	164(S: TemplateStringsArray): string { const r = Array.prototype.slice.call(S, 0); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	165(): string { const S: any = tagc165\`a\${1}b\${2}c\`; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	166(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	167(S: any): string { return String.prototype.concat.apply("", S) + "|" + Math.max.apply(null, S)	168(): string { const S: any = tagc168\`a\${1}b\${2}c\`; return String.raw({ raw: S }, 1, 2)	169(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return String.raw({ raw: S }, 1, 2)	170(S: any): string { return String.raw({ raw: S }, 1, 2)
171(): string { const S: TemplateStringsArray = tagc171\`a\${1}b\${2}c\`; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	172(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	173(S: TemplateStringsArray): string { const r = structuredClone(S); return typeof r[0] + ":" + r[0] + "|" + typeof r[1] + ":" + r[1] + "|" + r.length + "|" + show(r)	174(): string { const S: TemplateStringsArray = tagc174\`a\${1}b\${2}c\`; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	175(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	176(S: TemplateStringsArray): string { return Array.isArray(S) + "|" + Object.isFrozen(S) + "|" + S.length + "|" + (0 in S) + "|" + (5 in S) + "|" + S.hasOwnProperty(1)	177(): string { const S: TemplateStringsArray = tagc177\`a\${1}b\${2}c\`; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	178(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: TemplateStringsArray = strings; const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable	179(S: TemplateStringsArray): string { const d = Object.getOwnPropertyDescriptor(S, 0); return typeof d.value + d.value + d.writable + d.enumerable + d.configurable
180(): string { const S: any = tagc180\`a\${1}b\${2}c\`; S.push("x"); return "pushed"	181(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; S.push("x"); return "pushed"	182(S: any): string { S.push("x"); return "pushed"	183(): string { const S: any = tagc183\`a\${1}b\${2}c\`; return "popped " + S.pop()	184(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return "popped " + S.pop()	185(S: any): string { return "popped " + S.pop()	186(): string { const S: any = tagc186\`a\${1}b\${2}c\`; return "shifted " + S.shift()	187(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return "shifted " + S.shift()	188(S: any): string { return "shifted " + S.shift()
189(): string { const S: any = tagc189\`a\${1}b\${2}c\`; S.unshift("x"); return "unshifted"	190(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; S.unshift("x"); return "unshifted"	191(S: any): string { S.unshift("x"); return "unshifted"	192(): string { const S: any = tagc192\`a\${1}b\${2}c\`; return show(S.reverse())	193(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.reverse())	194(S: any): string { return show(S.reverse())	195(): string { const S: any = tagc195\`a\${1}b\${2}c\`; return show(S.sort())	196(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.sort())	197(S: any): string { return show(S.sort())
198(): string { const S: any = tagc198\`a\${1}b\${2}c\`; return show(S.splice(0, 1))	199(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.splice(0, 1))	200(S: any): string { return show(S.splice(0, 1))	201(): string { const S: any = tagc201\`a\${1}b\${2}c\`; return show(S.fill("f"))	202(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.fill("f"))	203(S: any): string { return show(S.fill("f"))	204(): string { const S: any = tagc204\`a\${1}b\${2}c\`; return show(S.copyWithin(0, 1))	205(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return show(S.copyWithin(0, 1))	206(S: any): string { return show(S.copyWithin(0, 1))
207(): string { const S: any = tagc207\`a\${1}b\${2}c\`; "use strict"; S[0] = "x"; return "stored"	208(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; "use strict"; S[0] = "x"; return "stored"	209(S: any): string { "use strict"; S[0] = "x"; return "stored"	210(): string { const S: any = tagc210\`a\${1}b\${2}c\`; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	211(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	212(S: any): string { return S.filter(p => p !== "b").map(p => p + "!").concat(S.slice(1)).join("/")	213(): string { const S: any = tagc213\`a\${1}b\${2}c\`; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	214(strings: TemplateStringsArray, ...rest: unknown[]): string { const S: any = strings; const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])	215(S: any): string { const r = S.map(p => p); return typeof S[0] + S[0] + typeof r[0] + r[0] + (r[0] === S[0])`,
        (
          n,
          a,
          b,
          c,
          d,
          e,
          f,
          g,
          h,
          i,
        ) => `const tagc${9 * n} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${a}; }
function inc${b}; }
function c${9 * n + 1}(): string { return inc${9 * n + 1}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 2} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${c}; }
function c${9 * n + 2}(): string { return hc${9 * n + 2}(tagc${9 * n + 2}\`a\${1}b\${2}c\`); }
const tagc${9 * n + 3} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${d}; }
function inc${e}; }
function c${9 * n + 4}(): string { return inc${9 * n + 4}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 5} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${f}; }
function c${9 * n + 5}(): string { return hc${9 * n + 5}(tagc${9 * n + 5}\`a\${1}b\${2}c\`); }
const tagc${9 * n + 6} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function c${g}; }
function inc${h}; }
function c${9 * n + 7}(): string { return inc${9 * n + 7}\`a\${1}b\${2}c\`; }
const tagc${9 * n + 8} = (strings: TemplateStringsArray, ...rest: unknown[]) => strings;
function hc${i}; }
function c${9 * n + 8}(): string { return hc${9 * n + 8}(tagc${9 * n + 8}\`a\${1}b\${2}c\`); }`,
      ],
      `const cases: [string, () => string][] = [["at here", c0], ["at in-tag", c1], ["at helper", c2], ["concat here", c3], ["concat in-tag", c4], ["concat helper", c5], ["concat-more here", c6], ["concat-more in-tag", c7], ["concat-more helper", c8], ["concat-onto here", c9], ["concat-onto in-tag", c10], ["concat-onto helper", c11], ["entries here", c12], ["entries in-tag", c13], ["entries helper", c14], ["every here", c15], ["every in-tag", c16], ["every helper", c17], ["filter here", c18], ["filter in-tag", c19], ["filter helper", c20], ["filter-length here", c21], ["filter-length in-tag", c22], ["filter-length helper", c23], ["find here", c24], ["find in-tag", c25], ["find helper", c26], ["findIndex here", c27], ["findIndex in-tag", c28], ["findIndex helper", c29], ["findLast here", c30], ["findLast in-tag", c31], ["findLast helper", c32], ["findLastIndex here", c33], ["findLastIndex in-tag", c34], ["findLastIndex helper", c35], ["flat here", c36], ["flat in-tag", c37], ["flat helper", c38], ["flatMap here", c39], ["flatMap in-tag", c40], ["flatMap helper", c41], ["forEach here", c42], ["forEach in-tag", c43], ["forEach helper", c44], ["forEach-method here", c45], ["forEach-method in-tag", c46], ["forEach-method helper", c47], ["includes here", c48], ["includes in-tag", c49], ["includes helper", c50], ["indexOf here", c51], ["indexOf in-tag", c52], ["indexOf helper", c53], ["join here", c54], ["join in-tag", c55], ["join helper", c56], ["keys here", c57], ["keys in-tag", c58], ["keys helper", c59], ["map here", c60], ["map in-tag", c61], ["map helper", c62], ["map-join here", c63], ["map-join in-tag", c64], ["map-join helper", c65], ["map-typeof here", c66], ["map-typeof in-tag", c67], ["map-typeof helper", c68], ["map-index here", c69], ["map-index in-tag", c70], ["map-index helper", c71], ["reduce here", c72], ["reduce in-tag", c73], ["reduce helper", c74], ["reduce-first here", c75], ["reduce-first in-tag", c76], ["reduce-first helper", c77], ["reduceRight here", c78], ["reduceRight in-tag", c79], ["reduceRight helper", c80], ["slice here", c81], ["slice in-tag", c82], ["slice helper", c83], ["slice-1 here", c84], ["slice-1 in-tag", c85], ["slice-1 helper", c86], ["some here", c87], ["some in-tag", c88], ["some helper", c89], ["toReversed here", c90], ["toReversed in-tag", c91], ["toReversed helper", c92], ["toSorted here", c93], ["toSorted in-tag", c94], ["toSorted helper", c95], ["toSpliced here", c96], ["toSpliced in-tag", c97], ["toSpliced helper", c98], ["with here", c99], ["with in-tag", c100], ["with helper", c101], ["toString here", c102], ["toString in-tag", c103], ["toString helper", c104], ["values here", c105], ["values in-tag", c106], ["values helper", c107], ["for-of here", c108], ["for-of in-tag", c109], ["for-of helper", c110], ["for-in here", c111], ["for-in in-tag", c112], ["for-in helper", c113], ["index-loop here", c114], ["index-loop in-tag", c115], ["index-loop helper", c116], ["spread here", c117], ["spread in-tag", c118], ["spread helper", c119], ["spread-call here", c120], ["spread-call in-tag", c121], ["spread-call helper", c122], ["destructure here", c123], ["destructure in-tag", c124], ["destructure helper", c125], ["Array.from here", c126], ["Array.from in-tag", c127], ["Array.from helper", c128], ["Array.from-map here", c129], ["Array.from-map in-tag", c130], ["Array.from-map helper", c131], ["Array.of here", c132], ["Array.of in-tag", c133], ["Array.of helper", c134], ["Object.values here", c135], ["Object.values in-tag", c136], ["Object.values helper", c137], ["Object.entries here", c138], ["Object.entries in-tag", c139], ["Object.entries helper", c140], ["Object.keys here", c141], ["Object.keys in-tag", c142], ["Object.keys helper", c143], ["Object.assign here", c144], ["Object.assign in-tag", c145], ["Object.assign helper", c146], ["object-spread here", c147], ["object-spread in-tag", c148], ["object-spread helper", c149], ["JSON here", c150], ["JSON in-tag", c151], ["JSON helper", c152], ["Set here", c153], ["Set in-tag", c154], ["Set helper", c155], ["Map here", c156], ["Map in-tag", c157], ["Map helper", c158], ["call-map here", c159], ["call-map in-tag", c160], ["call-map helper", c161], ["call-slice here", c162], ["call-slice in-tag", c163], ["call-slice helper", c164], ["apply here", c165], ["apply in-tag", c166], ["apply helper", c167], ["String.raw here", c168], ["String.raw in-tag", c169], ["String.raw helper", c170], ["structuredClone here", c171], ["structuredClone in-tag", c172], ["structuredClone helper", c173], ["isArray here", c174], ["isArray in-tag", c175], ["isArray helper", c176], ["descriptor here", c177], ["descriptor in-tag", c178], ["descriptor helper", c179], ["push here", c180], ["push in-tag", c181], ["push helper", c182], ["pop here", c183], ["pop in-tag", c184], ["pop helper", c185], ["shift here", c186], ["shift in-tag", c187], ["shift helper", c188], ["unshift here", c189], ["unshift in-tag", c190], ["unshift helper", c191], ["reverse here", c192], ["reverse in-tag", c193], ["reverse helper", c194], ["sort here", c195], ["sort in-tag", c196], ["sort helper", c197], ["splice here", c198], ["splice in-tag", c199], ["splice helper", c200], ["fill here", c201], ["fill in-tag", c202], ["fill helper", c203], ["copyWithin here", c204], ["copyWithin in-tag", c205], ["copyWithin helper", c206], ["store here", c207], ["store in-tag", c208], ["store helper", c209], ["chain here", c210], ["chain in-tag", c211], ["chain helper", c212], ["then-read here", c213], ["then-read in-tag", c214], ["then-read helper", c215]];
const only = process.argv[2];
for (let i = 0; i < cases.length; i++) {
  if (only !== undefined && Number(only) !== i) continue;
  let said;
  try { said = cases[i][1](); } catch (e) { said = "throws " + (e as any).constructor.name; }
  console.log(i + " " + cases[i][0] + ": " + said);
}
if (only === "count") console.log(cases.length);

`,
    ),
    "method-calls-on-unescaped-receivers-untyped.ts": text(
      `
function show(v: unknown): string {
    if (Array.isArray(v)) {
        const parts: string[] = [];
        for (let i = 0; i < v.length && i < 14; i++) parts.push(i in v ? show(v[i]) : "hole");
        const own = Object.getOwnPropertyNames(v).filter(k => k !== "length" && !/^\\d+$/.test(k));
        return "[" + parts.join(",") + (v.length > 14 ? ",.. " + v.length : "") + "]" + (own.length ? "{" + own.join(",") + "}" : "") + (Object.getPrototypeOf(v) === Array.prototype ? "" : "^") + (Object.isFrozen(v) ? "F" : Object.isSealed(v) ? "S" : Object.isExtensible(v) ? "" : "X");
    }
    if (typeof v === "function") return "function";
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "object") return Object.prototype.toString.call(v);
    if (typeof v === "number" && v === 0 && 1 / v < 0) return "-0";
    return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function thrown(e: unknown): string { return "throws " + (e instanceof Error ? e.constructor.name : show(e)); }
const yes: boolean = Date.now() > 0;
const no: boolean = Date.now() < 0;
const holder: { it: any } = { it: undefined };
const given: number[] = [3, 1, 2];
function otherPrototype(m: string): any { const p: any = Object.create(Array.prototype); p[m] = function () { return "of another prototype"; }; return p; }
class Heir extends Array<number> { }
const meddlers: Array<(x: any, m: string) => void> = [
    (x, m) => { x[m] = () => "its own, given elsewhere"; },
    (x, m) => { Object.setPrototypeOf(x, otherPrototype(m)); },
    (x, m) => { },
];
function alterWhatIsHeld(m: string): void { holder.it[m] = () => "its own, through the holder"; }
function rest(...all: number[]): number[] { return all; }
const lines: string[] = [];
let memoized: any | undefined;
let calls = 0;
function fill(out: any): void { }
function fresh(): any { const out: any = []; for (const x of given) { calls++; if (x > 0) out.push(x); else if (x < -5) out.push(-x); } return out; }
function freshLiteral(): any { calls++; if (no) return [9, 9]; const out: any = [3, 1, 2]; for (let i = 0; i < 2; i++) calls += out.length; return out; }
function freshSpread(): any { calls++; for (let i = 0; i < 2; i++) calls += i; return [...given]; }
function freshKeys(): any { calls++; for (let i = 0; i < 2; i++) calls += i; return Object.values({ a: 3, b: 1, c: 2 }); }
function throughFresh(): any { calls++; for (let i = 0; i < 2; i++) calls += i; return fresh(); }
function recursive(n: number): any { calls++; if (n > 0) return recursive(n - 1); const out: any = []; for (const x of given) out.push(x); return out; }
function kept(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } holder.it = out; return out; }
function keptOnOneRoad(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } if (yes) holder.it = out; return out; }
function keptByClosure(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } holder.it = { set map(f: unknown) { (out as any).map = f; }, set join(f: unknown) { (out as any).join = f; }, set push(f: unknown) { (out as any).push = f; } }; return out; }
function handedOn(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } meddlers[yes ? 2 : 0](out, "x"); return out; }
function memo(): any { calls++; for (let i = 0; i < 2; i++) calls += i; if (!memoized) memoized = [3, 1, 2]; holder.it = memoized; return memoized; }
function oneOfTwo(): any { calls++; for (let i = 0; i < 2; i++) calls += i; if (yes) { holder.it = given2; return given2; } return [3, 1, 2]; }
function alteredInside(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } (out as any).map = () => "its own, from the maker"; (out as any).join = () => "its own, from the maker"; return out; }
function anHeir(): any { calls++; for (let i = 0; i < 2; i++) calls += i; const out = new Heir(); out.push(3, 1, 2); return out; }
function frozenInside(): any { const out: any = []; for (const x of given) { calls++; out.push(x); } return Object.freeze(out) as any; }
const given2: any = [3, 1, 2];
`,
      [
        `map((x: number) => x * 2	map: " + c1
join("-"	join: " + c2
indexOf(1	indexOf: " + c3
slice(1	slice: " + c4
concat([9]	concat: " + c5
push(7	push: " + c6
pop(	pop: " + c7
sort(	sort: " + c8`,
        (n, a, b) => `function c${n + 1}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing ${b}());`,
      ],
      [
        `.map = () => "its own	map((x: number) => x * 2	 map: " + c9
.join = () => "its own	join("-"	 join: " + c10
.indexOf = () => "its own	indexOf(1	 indexOf: " + c11
.slice = () => "its own	slice(1	 slice: " + c12
.concat = () => "its own	concat([9]	 concat: " + c13
.push = () => "its own	push(7	 push: " + c14
.pop = () => "its own	pop(	 pop: " + c15
.sort = () => "its own	sort(	 sort: " + c16
["map"] = () => "its own by key	map((x: number) => x * 2	ByKey map: " + c17
["join"] = () => "its own by key	join("-"	ByKey join: " + c18
["indexOf"] = () => "its own by key	indexOf(1	ByKey indexOf: " + c19
["slice"] = () => "its own by key	slice(1	ByKey slice: " + c20
["concat"] = () => "its own by key	concat([9]	ByKey concat: " + c21
["push"] = () => "its own by key	push(7	ByKey push: " + c22
["pop"] = () => "its own by key	pop(	ByKey pop: " + c23
["sort"] = () => "its own by key	sort(	ByKey sort: " + c24`,
        (n, a, b, c) => `function c${n + 9}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a}";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c25
join	join("-"	join: " + c26
indexOf	indexOf(1	indexOf: " + c27
slice	slice(1	slice: " + c28
concat	concat([9]	concat: " + c29
push	push(7	push: " + c30
pop	pop(	pop: " + c31
sort	sort(	sort: " + c32`,
        (n, a, b, c) => `function c${n + 25}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "${a}" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey ${c}());`,
      ],
      [
        `Object.setPrototypeOf(a, otherPrototype("map	map((x: number) => x * 2	 map: " + c33	Object.setPrototypeOf(a, otherPrototype("join	join("-"	 join: " + c34	Object.setPrototypeOf(a, otherPrototype("indexOf	indexOf(1	 indexOf: " + c35	Object.setPrototypeOf(a, otherPrototype("slice	lice(1	 slice: " + c36
Object.setPrototypeOf(a, otherPrototype("concat	concat([9]	 concat: " + c37	Object.setPrototypeOf(a, otherPrototype("push	push(7	 push: " + c38	Object.setPrototypeOf(a, otherPrototype("pop	pop(	 pop: " + c39	Object.setPrototypeOf(a, otherPrototype("sort	ort(	 sort: " + c40
Reflect.setPrototypeOf(a, otherPrototype("map	map((x: number) => x * 2	ByReflect map: " + c41	Reflect.setPrototypeOf(a, otherPrototype("join	join("-"	ByReflect join: " + c42	Reflect.setPrototypeOf(a, otherPrototype("indexOf	indexOf(1	ByReflect indexOf: " + c43	Reflect.setPrototypeOf(a, otherPrototype("slice	lice(1	ByReflect slice: " + c44`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l) => `function c${4 * n + 33}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    ${a}"));
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype${c}());
function c${4 * n + 34}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    ${d}"));
    try { r = a.${e}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype${f}());
function c${4 * n + 35}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    ${g}"));
    try { r = a.${h}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype${i}());
function c${4 * n + 36}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    ${j}"));
    try { r = a.s${k}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype${l}());`,
      ],
      [
        `concat	concat([9]	concat: " + c45
push	push(7	push: " + c46
pop	pop(	pop: " + c47
sort	sort(	sort: " + c48`,
        (n, a, b, c) => `function c${n + 45}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("${a}"));
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c49
join	join("-"	join: " + c50
indexOf	indexOf(1	indexOf: " + c51
slice	slice(1	slice: " + c52
concat	concat([9]	concat: " + c53
push	push(7	push: " + c54
pop	pop(	pop: " + c55
sort	sort(	sort: " + c56`,
        (n, a, b, c) => `function c${n + 49}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName ${c}());`,
      ],
      [
        `setPrototypeOf(a, null	map((x: number) => x * 2	noPrototype map: " + c57	setPrototypeOf(a, null	join("-"	noPrototype join: " + c58	setPrototypeOf(a, null	indexOf(1	noPrototype indexOf: " + c59
setPrototypeOf(a, null	slice(1	noPrototype slice: " + c60	setPrototypeOf(a, null	concat([9]	noPrototype concat: " + c61	setPrototypeOf(a, null	push(7	noPrototype push: " + c62
setPrototypeOf(a, null	pop(	noPrototype pop: " + c63	setPrototypeOf(a, null	sort(	noPrototype sort: " + c64	defineProperty(a, "map", { value: () => "defined", configurable: true }	map((x: number) => x * 2	defined map: " + c65
defineProperty(a, "join", { value: () => "defined", configurable: true }	join("-"	defined join: " + c66	defineProperty(a, "indexOf", { value: () => "defined", configurable: true }	indexOf(1	defined indexOf: " + c67	defineProperty(a, "slice", { value: () => "defined", configurable: true }	slice(1	defined slice: " + c68
defineProperty(a, "concat", { value: () => "defined", configurable: true }	concat([9]	defined concat: " + c69	defineProperty(a, "push", { value: () => "defined", configurable: true }	push(7	defined push: " + c70	defineProperty(a, "pop", { value: () => "defined", configurable: true }	pop(	defined pop: " + c71
defineProperty(a, "sort", { value: () => "defined", configurable: true }	sort(	defined sort: " + c72	defineProperty(a, "map", { get: () => () => "by a getter", configurable: true }	map((x: number) => x * 2	definedGetter map: " + c73	defineProperty(a, "join", { get: () => () => "by a getter", configurable: true }	join("-"	definedGetter join: " + c74
defineProperty(a, "indexOf", { get: () => () => "by a getter", configurable: true }	indexOf(1	definedGetter indexOf: " + c75	defineProperty(a, "slice", { get: () => () => "by a getter", configurable: true }	slice(1	definedGetter slice: " + c76	defineProperty(a, "concat", { get: () => () => "by a getter", configurable: true }	concat([9]	definedGetter concat: " + c77
defineProperty(a, "push", { get: () => () => "by a getter", configurable: true }	push(7	definedGetter push: " + c78	defineProperty(a, "pop", { get: () => () => "by a getter", configurable: true }	pop(	definedGetter pop: " + c79	defineProperty(a, "sort", { get: () => () => "by a getter", configurable: true }	sort(	definedGetter sort: " + c80
assign(a, { map: () => "assigned" }	map((x: number) => x * 2	assigned map: " + c81	assign(a, { join: () => "assigned" }	join("-"	assigned join: " + c82	assign(a, { indexOf: () => "assigned" }	indexOf(1	assigned indexOf: " + c83
assign(a, { slice: () => "assigned" }	slice(1	assigned slice: " + c84	assign(a, { concat: () => "assigned" }	concat([9]	assigned concat: " + c85	assign(a, { push: () => "assigned" }	push(7	assigned push: " + c86
assign(a, { pop: () => "assigned" }	pop(	assigned pop: " + c87	assign(a, { sort: () => "assigned" }	sort(	assigned sort: " + c88	defineProperty(a, 0, { get: () => 42, configurable: true }	map((x: number) => x * 2	getterElement map: " + c89
defineProperty(a, 0, { get: () => 42, configurable: true }	join("-"	getterElement join: " + c90	defineProperty(a, 0, { get: () => 42, configurable: true }	indexOf(1	getterElement indexOf: " + c91	defineProperty(a, 0, { get: () => 42, configurable: true }	slice(1	getterElement slice: " + c92
defineProperty(a, 0, { get: () => 42, configurable: true }	concat([9]	getterElement concat: " + c93	defineProperty(a, 0, { get: () => 42, configurable: true }	push(7	getterElement push: " + c94	defineProperty(a, 0, { get: () => 42, configurable: true }	pop(	getterElement pop: " + c95
defineProperty(a, 0, { get: () => 42, configurable: true }	sort(	getterElement sort: " + c96	freeze(a	map((x: number) => x * 2	frozen map: " + c97	freeze(a	join("-"	frozen join: " + c98
freeze(a	indexOf(1	frozen indexOf: " + c99	freeze(a	slice(1	frozen slice: " + c100	freeze(a	concat([9]	frozen concat: " + c101
freeze(a	push(7	frozen push: " + c102	freeze(a	pop(	frozen pop: " + c103	freeze(a	sort(	frozen sort: " + c104
seal(a	map((x: number) => x * 2	sealed map: " + c105	seal(a	join("-"	sealed join: " + c106	seal(a	indexOf(1	sealed indexOf: " + c107
seal(a	slice(1	sealed slice: " + c108	seal(a	concat([9]	sealed concat: " + c109	seal(a	push(7	sealed push: " + c110
seal(a	pop(	sealed pop: " + c111	seal(a	sort(	sealed sort: " + c112	preventExtensions(a	map((x: number) => x * 2	notExtensible map: " + c113
preventExtensions(a	join("-"	notExtensible join: " + c114	preventExtensions(a	indexOf(1	notExtensible indexOf: " + c115	preventExtensions(a	slice(1	notExtensible slice: " + c116
preventExtensions(a	concat([9]	notExtensible concat: " + c117	preventExtensions(a	push(7	notExtensible push: " + c118	preventExtensions(a	pop(	notExtensible pop: " + c119
preventExtensions(a	sort(	notExtensible sort: " + c120	defineProperty(a, "length", { writable: false }	map((x: number) => x * 2	lengthReadOnly map: " + c121	defineProperty(a, "length", { writable: false }	join("-"	lengthReadOnly join: " + c122
defineProperty(a, "length", { writable: false }	indexOf(1	lengthReadOnly indexOf: " + c123	defineProperty(a, "length", { writable: false }	slice(1	lengthReadOnly slice: " + c124	defineProperty(a, "length", { writable: false }	concat([9]	lengthReadOnly concat: " + c125
defineProperty(a, "length", { writable: false }	push(7	lengthReadOnly push: " + c126	defineProperty(a, "length", { writable: false }	pop(	lengthReadOnly pop: " + c127	defineProperty(a, "length", { writable: false }	sort(	lengthReadOnly sort: " + c128`,
        (n, a, b, c, d, e, f, g, h, i) => `function c${3 * n + 57}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.${a});
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${3 * n + 58}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.${d});
    try { r = a.${e}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${f}());
function c${3 * n + 59}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.${g});
    try { r = a.${h}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${i}());`,
      ],
      [
        `1	map((x: number) => x * 2	shorter map: " + c129
1	join("-"	shorter join: " + c130
1	indexOf(1	shorter indexOf: " + c131
1	slice(1	shorter slice: " + c132
1	concat([9]	shorter concat: " + c133
1	push(7	shorter push: " + c134
1	pop(	shorter pop: " + c135
1	sort(	shorter sort: " + c136
6	map((x: number) => x * 2	longer map: " + c137
6	join("-"	longer join: " + c138
6	indexOf(1	longer indexOf: " + c139
6	slice(1	longer slice: " + c140
6	concat([9]	longer concat: " + c141
6	push(7	longer push: " + c142
6	pop(	longer pop: " + c143
6	sort(	longer sort: " + c144`,
        (n, a, b, c) => `function c${n + 129}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = ${a};
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c145
join("-"	join: " + c146
indexOf(1	indexOf: " + c147
slice(1	slice: " + c148
concat([9]	concat: " + c149
push(7	push: " + c150
pop(	pop: " + c151
sort(	sort: " + c152`,
        (n, a, b) => `function c${n + 145}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement ${b}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c153
join("-"	join: " + c154
indexOf(1	indexOf: " + c155
slice(1	slice: " + c156
concat([9]	concat: " + c157
push(7	push: " + c158
pop(	pop: " + c159
sort(	sort: " + c160`,
        (n, a, b) => `function c${n + 153}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted ${b}());`,
      ],
      [
        `.extra = 1	map((x: number) => x * 2	harmlessName map: " + c161	join("-"	harmlessName join: " + c162
.extra = 1	indexOf(1	harmlessName indexOf: " + c163	slice(1	harmlessName slice: " + c164
.extra = 1	concat([9]	harmlessName concat: " + c165	push(7	harmlessName push: " + c166
.extra = 1	pop(	harmlessName pop: " + c167	sort(	harmlessName sort: " + c168
[-1] = 5	map((x: number) => x * 2	negativeKey map: " + c169	join("-"	negativeKey join: " + c170
[-1] = 5	indexOf(1	negativeKey indexOf: " + c171	slice(1	negativeKey slice: " + c172
[-1] = 5	concat([9]	negativeKey concat: " + c173	push(7	negativeKey push: " + c174
[-1] = 5	pop(	negativeKey pop: " + c175	sort(	negativeKey sort: " + c176
[1.5] = 5	map((x: number) => x * 2	fractionKey map: " + c177	join("-"	fractionKey join: " + c178
[1.5] = 5	indexOf(1	fractionKey indexOf: " + c179	slice(1	fractionKey slice: " + c180
[1.5] = 5	concat([9]	fractionKey concat: " + c181	push(7	fractionKey push: " + c182
[1.5] = 5	pop(	fractionKey pop: " + c183	sort(	fractionKey sort: " + c184`,
        (n, a, b, c, d, e) => `function c${2 * n + 161}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a};
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${2 * n + 162}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a};
    try { r = a.${d}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${e}());`,
      ],
      [
        `0 : 2](a, "map	map((x: number) => x * 2	 map: " + c185	0 : 2](a, "join	join("-"	 join: " + c186
0 : 2](a, "indexOf	indexOf(1	 indexOf: " + c187	0 : 2](a, "slice	slice(1	 slice: " + c188
0 : 2](a, "concat	concat([9]	 concat: " + c189	0 : 2](a, "push	push(7	 push: " + c190
0 : 2](a, "pop	pop(	 pop: " + c191	0 : 2](a, "sort	sort(	 sort: " + c192
1 : 2](a, "map	map((x: number) => x * 2	Prototype map: " + c193	1 : 2](a, "join	join("-"	Prototype join: " + c194
1 : 2](a, "indexOf	indexOf(1	Prototype indexOf: " + c195	1 : 2](a, "slice	slice(1	Prototype slice: " + c196
1 : 2](a, "concat	concat([9]	Prototype concat: " + c197	1 : 2](a, "push	push(7	Prototype push: " + c198
1 : 2](a, "pop	pop(	Prototype pop: " + c199	1 : 2](a, "sort	sort(	Prototype sort: " + c200
2 : 0](a, "map	map((x: number) => x * 2	Nothing map: " + c201	2 : 0](a, "join	join("-"	Nothing join: " + c202
2 : 0](a, "indexOf	indexOf(1	Nothing indexOf: " + c203	2 : 0](a, "slice	slice(1	Nothing slice: " + c204
2 : 0](a, "concat	concat([9]	Nothing concat: " + c205	2 : 0](a, "push	push(7	Nothing push: " + c206
2 : 0](a, "pop	pop(	Nothing pop: " + c207	2 : 0](a, "sort	sort(	Nothing sort: " + c208`,
        (n, a, b, c, d, e, f) => `function c${2 * n + 185}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? ${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere${c}());
function c${2 * n + 186}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? ${d}");
    try { r = a.${e}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere${f}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c209
join	join("-"	join: " + c210
indexOf	indexOf(1	indexOf: " + c211
slice	slice(1	slice: " + c212
concat	concat([9]	concat: " + c213
push	push(7	push: " + c214
pop	pop(	pop: " + c215
sort	sort(	sort: " + c216`,
        (n, a, b, c) => `function c${n + 209}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c217
join	join("-"	join: " + c218
indexOf	indexOf(1	indexOf: " + c219
slice	slice(1	slice: " + c220
concat	concat([9]	concat: " + c221
push	push(7	push: " + c222
pop	pop(	pop: " + c223
sort	sort(	sort: " + c224`,
        (n, a, b, c) => `function c${n + 217}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).${a} = () => "its own, by a closure"; }; alter();
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c225
join	join("-"	join: " + c226
indexOf	indexOf(1	indexOf: " + c227
slice	slice(1	slice: " + c228
concat	concat([9]	concat: " + c229
push	push(7	push: " + c230
pop	pop(	pop: " + c231
sort	sort(	sort: " + c232`,
        (n, a, b, c) => `function c${n + 225}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.${a} = () => "its own, by a callback"; });
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c233
join	join("-"	join: " + c234
indexOf	indexOf(1	indexOf: " + c235
slice	slice(1	slice: " + c236
concat	concat([9]	concat: " + c237
push	push(7	push: " + c238
pop	pop(	pop: " + c239
sort	sort(	sort: " + c240`,
        (n, a, b, c) => `function c${n + 233}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.${a} = () => "its own, by a callback of map"; return x; });
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap ${c}());`,
      ],
      [
        `.constructor = Heir	map((x: number) => x * 2	species map: " + c241	join("-"	species join: " + c242
.constructor = Heir	indexOf(1	species indexOf: " + c243	slice(1	species slice: " + c244
.constructor = Heir	concat([9]	species concat: " + c245	push(7	species push: " + c246
.constructor = Heir	pop(	species pop: " + c247	sort(	species sort: " + c248
.constructor = { [Symbol.species]: Heir }	map((x: number) => x * 2	speciesObject map: " + c249	join("-"	speciesObject join: " + c250
.constructor = { [Symbol.species]: Heir }	indexOf(1	speciesObject indexOf: " + c251	slice(1	speciesObject slice: " + c252
.constructor = { [Symbol.species]: Heir }	concat([9]	speciesObject concat: " + c253	push(7	speciesObject push: " + c254
.constructor = { [Symbol.species]: Heir }	pop(	speciesObject pop: " + c255	sort(	speciesObject sort: " + c256
[Symbol.isConcatSpreadable] = false	map((x: number) => x * 2	notSpreadable map: " + c257	join("-"	notSpreadable join: " + c258
[Symbol.isConcatSpreadable] = false	indexOf(1	notSpreadable indexOf: " + c259	slice(1	notSpreadable slice: " + c260
[Symbol.isConcatSpreadable] = false	concat([9]	notSpreadable concat: " + c261	push(7	notSpreadable push: " + c262
[Symbol.isConcatSpreadable] = false	pop(	notSpreadable pop: " + c263	sort(	notSpreadable sort: " + c264
[Symbol.iterator] = function* () { yield 99; }	map((x: number) => x * 2	ownIterator map: " + c265	join("-"	ownIterator join: " + c266
[Symbol.iterator] = function* () { yield 99; }	indexOf(1	ownIterator indexOf: " + c267	slice(1	ownIterator slice: " + c268
[Symbol.iterator] = function* () { yield 99; }	concat([9]	ownIterator concat: " + c269	push(7	ownIterator push: " + c270
[Symbol.iterator] = function* () { yield 99; }	pop(	ownIterator pop: " + c271	sort(	ownIterator sort: " + c272`,
        (n, a, b, c, d, e) => `function c${2 * n + 241}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a};
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${2 * n + 242}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a};
    try { r = a.${d}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${e}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c273
join	join("-"	join: " + c274
indexOf	indexOf(1	indexOf: " + c275
slice	slice(1	slice: " + c276
concat	concat([9]	concat: " + c277
push	push(7	push: " + c278
pop	pop(	pop: " + c279
sort	sort(	sort: " + c280`,
        (n, a, b, c) => `function c${n + 273}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).${a} = () => "its own, on one road";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c281
join	join("-"	join: " + c282
indexOf	indexOf(1	indexOf: " + c283
slice	slice(1	slice: " + c284
concat	concat([9]	concat: " + c285
push	push(7	push: " + c286
pop	pop(	pop: " + c287
sort	sort(	sort: " + c288`,
        (n, a, b, c) => `function c${n + 281}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).${a} = () => "never";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c289
join	join("-"	join: " + c290
indexOf	indexOf(1	indexOf: " + c291
slice	slice(1	slice: " + c292
concat	concat([9]	concat: " + c293
push	push(7	push: " + c294
pop	pop(	pop: " + c295
sort	sort(	sort: " + c296`,
        (n, a, b, c) => `function c${n + 289}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).${a} = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry ${c}());`,
      ],
      [
        `same: any = a.sort(); same.map = () => "its own, through what sort returns	map((x: number) => x * 2	throughSort map: " + c297	same: any = a.sort(); same.join = () => "its own, through what sort returns	join("-"	throughSort join: " + c298
same: any = a.sort(); same.indexOf = () => "its own, through what sort returns	indexOf(1	throughSort indexOf: " + c299	same: any = a.sort(); same.slice = () => "its own, through what sort returns	slice(1	throughSort slice: " + c300
same: any = a.sort(); same.concat = () => "its own, through what sort returns	concat([9]	throughSort concat: " + c301	same: any = a.sort(); same.push = () => "its own, through what sort returns	push(7	throughSort push: " + c302
same: any = a.sort(); same.pop = () => "its own, through what sort returns	pop(	throughSort pop: " + c303	same: any = a.sort(); same.sort = () => "its own, through what sort returns	sort(	throughSort sort: " + c304
same = a as unknown as { map: unknown }; same.map = () => "its own, through a cast	map((x: number) => x * 2	throughCast map: " + c305	same = a as unknown as { join: unknown }; same.join = () => "its own, through a cast	join("-"	throughCast join: " + c306
same = a as unknown as { indexOf: unknown }; same.indexOf = () => "its own, through a cast	indexOf(1	throughCast indexOf: " + c307	same = a as unknown as { slice: unknown }; same.slice = () => "its own, through a cast	slice(1	throughCast slice: " + c308
same = a as unknown as { concat: unknown }; same.concat = () => "its own, through a cast	concat([9]	throughCast concat: " + c309	same = a as unknown as { push: unknown }; same.push = () => "its own, through a cast	push(7	throughCast push: " + c310
same = a as unknown as { pop: unknown }; same.pop = () => "its own, through a cast	pop(	throughCast pop: " + c311	same = a as unknown as { sort: unknown }; same.sort = () => "its own, through a cast	sort(	throughCast sort: " + c312
box: any[] = [a]; box[0].map = () => "its own, through an array	map((x: number) => x * 2	inArray map: " + c313	box: any[] = [a]; box[0].join = () => "its own, through an array	join("-"	inArray join: " + c314
box: any[] = [a]; box[0].indexOf = () => "its own, through an array	indexOf(1	inArray indexOf: " + c315	box: any[] = [a]; box[0].slice = () => "its own, through an array	slice(1	inArray slice: " + c316
box: any[] = [a]; box[0].concat = () => "its own, through an array	concat([9]	inArray concat: " + c317	box: any[] = [a]; box[0].push = () => "its own, through an array	push(7	inArray push: " + c318
box: any[] = [a]; box[0].pop = () => "its own, through an array	pop(	inArray pop: " + c319	box: any[] = [a]; box[0].sort = () => "its own, through an array	sort(	inArray sort: " + c320
box: any = { a }; box.a.map = () => "its own, through an object	map((x: number) => x * 2	inObject map: " + c321	box: any = { a }; box.a.join = () => "its own, through an object	join("-"	inObject join: " + c322
box: any = { a }; box.a.indexOf = () => "its own, through an object	indexOf(1	inObject indexOf: " + c323	box: any = { a }; box.a.slice = () => "its own, through an object	slice(1	inObject slice: " + c324
box: any = { a }; box.a.concat = () => "its own, through an object	concat([9]	inObject concat: " + c325	box: any = { a }; box.a.push = () => "its own, through an object	push(7	inObject push: " + c326
box: any = { a }; box.a.pop = () => "its own, through an object	pop(	inObject pop: " + c327	box: any = { a }; box.a.sort = () => "its own, through an object	sort(	inObject sort: " + c328`,
        (n, a, b, c, d, e, f) => `function c${2 * n + 297}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const ${a}";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${2 * n + 298}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    const ${d}";
    try { r = a.${e}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${f}());`,
      ],
      [
        `sum += x;	map((x: number) => x * 2	 map: " + c329
sum += x;	join("-"	 join: " + c330
sum += x;	indexOf(1	 indexOf: " + c331
sum += x;	slice(1	 slice: " + c332
sum += x;	concat([9]	 concat: " + c333
sum += x;	push(7	 push: " + c334
sum += x;	pop(	 pop: " + c335
sum += x;	sort(	 sort: " + c336
{ if (x === 1) (a as any).map = () => "its own, in a loop over it"; }	map((x: number) => x * 2	Altering map: " + c337
{ if (x === 1) (a as any).join = () => "its own, in a loop over it"; }	join("-"	Altering join: " + c338
{ if (x === 1) (a as any).indexOf = () => "its own, in a loop over it"; }	indexOf(1	Altering indexOf: " + c339
{ if (x === 1) (a as any).slice = () => "its own, in a loop over it"; }	slice(1	Altering slice: " + c340
{ if (x === 1) (a as any).concat = () => "its own, in a loop over it"; }	concat([9]	Altering concat: " + c341
{ if (x === 1) (a as any).push = () => "its own, in a loop over it"; }	push(7	Altering push: " + c342
{ if (x === 1) (a as any).pop = () => "its own, in a loop over it"; }	pop(	Altering pop: " + c343
{ if (x === 1) (a as any).sort = () => "its own, in a loop over it"; }	sort(	Altering sort: " + c344`,
        (n, a, b, c) => `function c${n + 329}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) ${a}
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated${c}());`,
      ],
      [
        `(a as unknown) === (given as unknown)	map((x: number) => x * 2	compared map: " + c345	join("-"	compared join: " + c346
(a as unknown) === (given as unknown)	indexOf(1	compared indexOf: " + c347	slice(1	compared slice: " + c348
(a as unknown) === (given as unknown)	concat([9]	compared concat: " + c349	push(7	compared push: " + c350
(a as unknown) === (given as unknown)	pop(	compared pop: " + c351	sort(	compared sort: " + c352
typeof a === "object"	map((x: number) => x * 2	typeOf map: " + c353	join("-"	typeOf join: " + c354
typeof a === "object"	indexOf(1	typeOf indexOf: " + c355	slice(1	typeOf slice: " + c356
typeof a === "object"	concat([9]	typeOf concat: " + c357	push(7	typeOf push: " + c358
typeof a === "object"	pop(	typeOf pop: " + c359	sort(	typeOf sort: " + c360
"length" in a	map((x: number) => x * 2	inByName map: " + c361	join("-"	inByName join: " + c362
"length" in a	indexOf(1	inByName indexOf: " + c363	slice(1	inByName slice: " + c364
"length" in a	concat([9]	inByName concat: " + c365	push(7	inByName push: " + c366
"length" in a	pop(	inByName pop: " + c367	sort(	inByName sort: " + c368`,
        (n, a, b, c, d, e) => `function c${2 * n + 345}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (${a}) sum++;
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${2 * n + 346}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (${a}) sum++;
    try { r = a.${d}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${e}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c369
join("-"	join: " + c370
indexOf(1	indexOf: " + c371
slice(1	slice: " + c372
concat([9]	concat: " + c373
push(7	push: " + c374
pop(	pop: " + c375
sort(	sort: " + c376`,
        (n, a, b) => `function c${n + 369}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy ${b}());`,
      ],
      [
        `a != null	map((x: number) => x * 2	notNil map: " + c377
a != null	join("-"	notNil join: " + c378
a != null	indexOf(1	notNil indexOf: " + c379
a != null	slice(1	notNil slice: " + c380
a != null	concat([9]	notNil concat: " + c381
a != null	push(7	notNil push: " + c382
a != null	pop(	notNil pop: " + c383
a != null	sort(	notNil sort: " + c384
Array.isArray(a)	map((x: number) => x * 2	isArray map: " + c385
Array.isArray(a)	join("-"	isArray join: " + c386
Array.isArray(a)	indexOf(1	isArray indexOf: " + c387
Array.isArray(a)	slice(1	isArray slice: " + c388
Array.isArray(a)	concat([9]	isArray concat: " + c389
Array.isArray(a)	push(7	isArray push: " + c390
Array.isArray(a)	pop(	isArray pop: " + c391
Array.isArray(a)	sort(	isArray sort: " + c392`,
        (n, a, b, c) => `function c${n + 377}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (${a}) sum++;
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());`,
      ],
      [
        `.length	map((x: number) => x * 2	lengthRead map: " + c393
.length	join("-"	lengthRead join: " + c394
.length	indexOf(1	lengthRead indexOf: " + c395
.length	slice(1	lengthRead slice: " + c396
.length	concat([9]	lengthRead concat: " + c397
.length	push(7	lengthRead push: " + c398
.length	pop(	lengthRead pop: " + c399
.length	sort(	lengthRead sort: " + c400
[0]	map((x: number) => x * 2	elementRead map: " + c401
[0]	join("-"	elementRead join: " + c402
[0]	indexOf(1	elementRead indexOf: " + c403
[0]	slice(1	elementRead slice: " + c404
[0]	concat([9]	elementRead concat: " + c405
[0]	push(7	elementRead push: " + c406
[0]	pop(	elementRead pop: " + c407
[0]	sort(	elementRead sort: " + c408`,
        (n, a, b, c) => `function c${n + 393}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a${a};
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c409
join("-"	join: " + c410
indexOf(1	indexOf: " + c411
slice(1	slice: " + c412
concat([9]	concat: " + c413
push(7	push: " + c414
pop(	pop: " + c415
sort(	sort: " + c416`,
        (n, a, b) => `function c${n + 409}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored ${b}());`,
      ],
      [
        `push(4	map((x: number) => x * 2	pushedBefore map: " + c417
push(4	join("-"	pushedBefore join: " + c418
push(4	indexOf(1	pushedBefore indexOf: " + c419
push(4	slice(1	pushedBefore slice: " + c420
push(4	concat([9]	pushedBefore concat: " + c421
push(4	push(7	pushedBefore push: " + c422
push(4	pop(	pushedBefore pop: " + c423
push(4	sort(	pushedBefore sort: " + c424
sort(	map((x: number) => x * 2	sortedBefore map: " + c425
sort(	join("-"	sortedBefore join: " + c426
sort(	indexOf(1	sortedBefore indexOf: " + c427
sort(	slice(1	sortedBefore slice: " + c428
sort(	concat([9]	sortedBefore concat: " + c429
sort(	push(7	sortedBefore push: " + c430
sort(	pop(	sortedBefore pop: " + c431
sort(	sort(	sortedBefore sort: " + c432`,
        (n, a, b, c) => `function c${n + 417}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.${a});
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c433
join("-"	join: " + c434
indexOf(1	indexOf: " + c435
slice(1	slice: " + c436
concat([9]	concat: " + c437
push(7	push: " + c438
pop(	pop: " + c439
sort(	sort: " + c440`,
        (n, a, b) => `function c${n + 433}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c441
join	join("-"	join: " + c442
indexOf	indexOf(1	indexOf: " + c443
slice	slice(1	slice: " + c444
concat	concat([9]	concat: " + c445
push	push(7	push: " + c446
pop	pop(	pop: " + c447
sort	sort(	sort: " + c448`,
        (n, a, b, c) => `function c${n + 441}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c449
join("-"	join: " + c450
indexOf(1	indexOf: " + c451
slice(1	slice: " + c452
concat([9]	concat: " + c453
push(7	push: " + c454
pop(	pop: " + c455
sort(	sort: " + c456`,
        (n, a, b) => `function c${n + 449}(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c457
join	join("-"	join: " + c458
indexOf	indexOf(1	indexOf: " + c459
slice	slice(1	slice: " + c460
concat	concat([9]	concat: " + c461
push	push(7	push: " + c462
pop	pop(	pop: " + c463
sort	sort(	sort: " + c464`,
        (n, a, b, c) => `function c${n + 457}(): string {
    const a: any = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c465
join("-"	join: " + c466
indexOf(1	indexOf: " + c467
slice(1	slice: " + c468
concat([9]	concat: " + c469
push(7	push: " + c470
pop(	pop: " + c471
sort(	sort: " + c472`,
        (n, a, b) => `function c${n + 465}(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c473
join	join("-"	join: " + c474
indexOf	indexOf(1	indexOf: " + c475
slice	slice(1	slice: " + c476
concat	concat([9]	concat: " + c477
push	push(7	push: " + c478
pop	pop(	pop: " + c479
sort	sort(	sort: " + c480`,
        (n, a, b, c) => `function c${n + 473}(): string {
    const a: any = [...given];
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c481
join("-"	join: " + c482
indexOf(1	indexOf: " + c483
slice(1	slice: " + c484
concat([9]	concat: " + c485
push(7	push: " + c486
pop(	pop: " + c487
sort(	sort: " + c488`,
        (n, a, b) => `function c${n + 481}(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c489
join	join("-"	join: " + c490
indexOf	indexOf(1	indexOf: " + c491
slice	slice(1	slice: " + c492
concat	concat([9]	concat: " + c493
push	push(7	push: " + c494
pop	pop(	pop: " + c495
sort	sort(	sort: " + c496`,
        (n, a, b, c) => `function c${n + 489}(): string {
    const a: any = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c497
join("-"	join: " + c498
indexOf(1	indexOf: " + c499
slice(1	slice: " + c500
concat([9]	concat: " + c501
push(7	push: " + c502
pop(	pop: " + c503
sort(	sort: " + c504`,
        (n, a, b) => `function c${n + 497}(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c505
join	join("-"	join: " + c506
indexOf	indexOf(1	indexOf: " + c507
slice	slice(1	slice: " + c508
concat	concat([9]	concat: " + c509
push	push(7	push: " + c510
pop	pop(	pop: " + c511
sort	sort(	sort: " + c512`,
        (n, a, b, c) => `function c${n + 505}(): string {
    const a: any = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c513
join("-"	join: " + c514
indexOf(1	indexOf: " + c515
slice(1	slice: " + c516
concat([9]	concat: " + c517
push(7	push: " + c518
pop(	pop: " + c519
sort(	sort: " + c520`,
        (n, a, b) => `function c${n + 513}(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c521
join	join("-"	join: " + c522
indexOf	indexOf(1	indexOf: " + c523
slice	slice(1	slice: " + c524
concat	concat([9]	concat: " + c525
push	push(7	push: " + c526
pop	pop(	pop: " + c527
sort	sort(	sort: " + c528`,
        (n, a, b, c) => `function c${n + 521}(): string {
    const a: any = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c529
join("-"	join: " + c530
indexOf(1	indexOf: " + c531
slice(1	slice: " + c532
concat([9]	concat: " + c533
push(7	push: " + c534
pop(	pop: " + c535
sort(	sort: " + c536`,
        (n, a, b) => `function c${n + 529}(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c537
join	join("-"	join: " + c538
indexOf	indexOf(1	indexOf: " + c539
slice	slice(1	slice: " + c540
concat	concat([9]	concat: " + c541
push	push(7	push: " + c542
pop	pop(	pop: " + c543
sort	sort(	sort: " + c544`,
        (n, a, b, c) => `function c${n + 537}(): string {
    const a: any = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c545
join("-"	join: " + c546
indexOf(1	indexOf: " + c547
slice(1	slice: " + c548
concat([9]	concat: " + c549
push(7	push: " + c550
pop(	pop: " + c551
sort(	sort: " + c552`,
        (n, a, b) => `function c${n + 545}(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c553
join	join("-"	join: " + c554
indexOf	indexOf(1	indexOf: " + c555
slice	slice(1	slice: " + c556
concat	concat([9]	concat: " + c557
push	push(7	push: " + c558
pop	pop(	pop: " + c559
sort	sort(	sort: " + c560`,
        (n, a, b, c) => `function c${n + 553}(): string {
    const a: any = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c561
join("-"	join: " + c562
indexOf(1	indexOf: " + c563
slice(1	slice: " + c564
concat([9]	concat: " + c565
push(7	push: " + c566
pop(	pop: " + c567
sort(	sort: " + c568`,
        (n, a, b) => `function c${n + 561}(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c569
join	join("-"	join: " + c570
indexOf	indexOf(1	indexOf: " + c571
slice	slice(1	slice: " + c572
concat	concat([9]	concat: " + c573
push	push(7	push: " + c574
pop	pop(	pop: " + c575
sort	sort(	sort: " + c576`,
        (n, a, b, c) => `function c${n + 569}(): string {
    const a: any = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c577
join("-"	join: " + c578
indexOf(1	indexOf: " + c579
slice(1	slice: " + c580
concat([9]	concat: " + c581
push(7	push: " + c582
pop(	pop: " + c583
sort(	sort: " + c584`,
        (n, a, b) => `function c${n + 577}(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c585
join	join("-"	join: " + c586
indexOf	indexOf(1	indexOf: " + c587
slice	slice(1	slice: " + c588
concat	concat([9]	concat: " + c589
push	push(7	push: " + c590
pop	pop(	pop: " + c591
sort	sort(	sort: " + c592`,
        (n, a, b, c) => `function c${n + 585}(): string {
    const a: any = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c593
join("-"	join: " + c594
indexOf(1	indexOf: " + c595
slice(1	slice: " + c596
concat([9]	concat: " + c597
push(7	push: " + c598
pop(	pop: " + c599
sort(	sort: " + c600`,
        (n, a, b) => `function c${n + 593}(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c601
join	join("-"	join: " + c602
indexOf	indexOf(1	indexOf: " + c603
slice	slice(1	slice: " + c604
concat	concat([9]	concat: " + c605
push	push(7	push: " + c606
pop	pop(	pop: " + c607
sort	sort(	sort: " + c608`,
        (n, a, b, c) => `function c${n + 601}(): string {
    const a: any = given.slice();
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c609
join("-"	join: " + c610
indexOf(1	indexOf: " + c611
slice(1	slice: " + c612
concat([9]	concat: " + c613
push(7	push: " + c614
pop(	pop: " + c615
sort(	sort: " + c616`,
        (n, a, b) => `function c${n + 609}(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c617
join	join("-"	join: " + c618
indexOf	indexOf(1	indexOf: " + c619
slice	slice(1	slice: " + c620
concat	concat([9]	concat: " + c621
push	push(7	push: " + c622
pop	pop(	pop: " + c623
sort	sort(	sort: " + c624`,
        (n, a, b, c) => `function c${n + 617}(): string {
    const a: any = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c625
join("-"	join: " + c626
indexOf(1	indexOf: " + c627
slice(1	slice: " + c628
concat([9]	concat: " + c629
push(7	push: " + c630
pop(	pop: " + c631
sort(	sort: " + c632`,
        (n, a, b) => `function c${n + 625}(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c633
join	join("-"	join: " + c634
indexOf	indexOf(1	indexOf: " + c635
slice	slice(1	slice: " + c636
concat	concat([9]	concat: " + c637
push	push(7	push: " + c638
pop	pop(	pop: " + c639
sort	sort(	sort: " + c640`,
        (n, a, b, c) => `function c${n + 633}(): string {
    const a: any = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c641
join("-"	join: " + c642
indexOf(1	indexOf: " + c643
slice(1	slice: " + c644
concat([9]	concat: " + c645
push(7	push: " + c646
pop(	pop: " + c647
sort(	sort: " + c648`,
        (n, a, b) => `function c${n + 641}(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c649
join	join("-"	join: " + c650
indexOf	indexOf(1	indexOf: " + c651
slice	slice(1	slice: " + c652
concat	concat([9]	concat: " + c653
push	push(7	push: " + c654
pop	pop(	pop: " + c655
sort	sort(	sort: " + c656`,
        (n, a, b, c) => `function c${n + 649}(): string {
    const a: any = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c657
join("-"	join: " + c658
indexOf(1	indexOf: " + c659
slice(1	slice: " + c660
concat([9]	concat: " + c661
push(7	push: " + c662
pop(	pop: " + c663
sort(	sort: " + c664`,
        (n, a, b) => `function c${n + 657}(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c665
join	join("-"	join: " + c666
indexOf	indexOf(1	indexOf: " + c667
slice	slice(1	slice: " + c668
concat	concat([9]	concat: " + c669
push	push(7	push: " + c670
pop	pop(	pop: " + c671
sort	sort(	sort: " + c672`,
        (n, a, b, c) => `function c${n + 665}(): string {
    const a: any = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c673
join("-"	join: " + c674
indexOf(1	indexOf: " + c675
slice(1	slice: " + c676
concat([9]	concat: " + c677
push(7	push: " + c678
pop(	pop: " + c679
sort(	sort: " + c680`,
        (n, a, b) => `function c${n + 673}(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c681
join	join("-"	join: " + c682
indexOf	indexOf(1	indexOf: " + c683
slice	slice(1	slice: " + c684
concat	concat([9]	concat: " + c685
push	push(7	push: " + c686
pop	pop(	pop: " + c687
sort	sort(	sort: " + c688`,
        (n, a, b, c) => `function c${n + 681}(): string {
    const a: any = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c689
join("-"	join: " + c690
indexOf(1	indexOf: " + c691
slice(1	slice: " + c692
concat([9]	concat: " + c693
push(7	push: " + c694
pop(	pop: " + c695
sort(	sort: " + c696`,
        (n, a, b) => `function c${n + 689}(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c697
join	join("-"	join: " + c698
indexOf	indexOf(1	indexOf: " + c699
slice	slice(1	slice: " + c700
concat	concat([9]	concat: " + c701
push	push(7	push: " + c702
pop	pop(	pop: " + c703
sort	sort(	sort: " + c704`,
        (n, a, b, c) => `function c${n + 697}(): string {
    const a: any = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c705
join("-"	join: " + c706
indexOf(1	indexOf: " + c707
slice(1	slice: " + c708
concat([9]	concat: " + c709
push(7	push: " + c710
pop(	pop: " + c711
sort(	sort: " + c712`,
        (n, a, b) => `function c${n + 705}(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c713
join	join("-"	join: " + c714
indexOf	indexOf(1	indexOf: " + c715
slice	slice(1	slice: " + c716
concat	concat([9]	concat: " + c717
push	push(7	push: " + c718
pop	pop(	pop: " + c719
sort	sort(	sort: " + c720`,
        (n, a, b, c) => `function c${n + 713}(): string {
    const a: any = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c721
join("-"	join: " + c722
indexOf(1	indexOf: " + c723
slice(1	slice: " + c724
concat([9]	concat: " + c725
push(7	push: " + c726
pop(	pop: " + c727
sort(	sort: " + c728`,
        (n, a, b) => `function c${n + 721}(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c729
join	join("-"	join: " + c730
indexOf	indexOf(1	indexOf: " + c731
slice	slice(1	slice: " + c732
concat	concat([9]	concat: " + c733
push	push(7	push: " + c734
pop	pop(	pop: " + c735
sort	sort(	sort: " + c736`,
        (n, a, b, c) => `function c${n + 729}(): string {
    const a: any = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c737
join("-"	join: " + c738
indexOf(1	indexOf: " + c739
slice(1	slice: " + c740
concat([9]	concat: " + c741
push(7	push: " + c742
pop(	pop: " + c743
sort(	sort: " + c744`,
        (n, a, b) => `function c${n + 737}(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c745
join	join("-"	join: " + c746
indexOf	indexOf(1	indexOf: " + c747
slice	slice(1	slice: " + c748
concat	concat([9]	concat: " + c749
push	push(7	push: " + c750
pop	pop(	pop: " + c751
sort	sort(	sort: " + c752`,
        (n, a, b, c) => `function c${n + 745}(): string {
    const a: any = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c753
join("-"	join: " + c754
indexOf(1	indexOf: " + c755
slice(1	slice: " + c756
concat([9]	concat: " + c757
push(7	push: " + c758
pop(	pop: " + c759
sort(	sort: " + c760`,
        (n, a, b) => `function c${n + 753}(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c761
join	join("-"	join: " + c762
indexOf	indexOf(1	indexOf: " + c763
slice	slice(1	slice: " + c764
concat	concat([9]	concat: " + c765
push	push(7	push: " + c766
pop	pop(	pop: " + c767
sort	sort(	sort: " + c768`,
        (n, a, b, c) => `function c${n + 761}(): string {
    const a: any = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c769
join("-"	join: " + c770
indexOf(1	indexOf: " + c771
slice(1	slice: " + c772
concat([9]	concat: " + c773
push(7	push: " + c774
pop(	pop: " + c775
sort(	sort: " + c776`,
        (n, a, b) => `function c${n + 769}(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c777
join	join("-"	join: " + c778
indexOf	indexOf(1	indexOf: " + c779
slice	slice(1	slice: " + c780
concat	concat([9]	concat: " + c781
push	push(7	push: " + c782
pop	pop(	pop: " + c783
sort	sort(	sort: " + c784`,
        (n, a, b, c) => `function c${n + 777}(): string {
    const a: any = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c785
join("-"	join: " + c786
indexOf(1	indexOf: " + c787
slice(1	slice: " + c788
concat([9]	concat: " + c789
push(7	push: " + c790
pop(	pop: " + c791
sort(	sort: " + c792`,
        (n, a, b) => `function c${n + 785}(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c793
join	join("-"	join: " + c794
indexOf	indexOf(1	indexOf: " + c795
slice	slice(1	slice: " + c796
concat	concat([9]	concat: " + c797
push	push(7	push: " + c798
pop	pop(	pop: " + c799
sort	sort(	sort: " + c800`,
        (n, a, b, c) => `function c${n + 793}(): string {
    const a: any = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c801
join("-"	join: " + c802
indexOf(1	indexOf: " + c803
slice(1	slice: " + c804
concat([9]	concat: " + c805
push(7	push: " + c806
pop(	pop: " + c807
sort(	sort: " + c808`,
        (n, a, b) => `function c${n + 801}(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c809
join	join("-"	join: " + c810
indexOf	indexOf(1	indexOf: " + c811
slice	slice(1	slice: " + c812
concat	concat([9]	concat: " + c813
push	push(7	push: " + c814
pop	pop(	pop: " + c815
sort	sort(	sort: " + c816`,
        (n, a, b, c) => `function c${n + 809}(): string {
    const a: any = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c817
join("-"	join: " + c818
indexOf(1	indexOf: " + c819
slice(1	slice: " + c820
concat([9]	concat: " + c821
push(7	push: " + c822
pop(	pop: " + c823
sort(	sort: " + c824`,
        (n, a, b) => `function c${n + 817}(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c825
join	join("-"	join: " + c826
indexOf	indexOf(1	indexOf: " + c827
slice	slice(1	slice: " + c828
concat	concat([9]	concat: " + c829
push	push(7	push: " + c830
pop	pop(	pop: " + c831
sort	sort(	sort: " + c832`,
        (n, a, b, c) => `function c${n + 825}(): string {
    const a: any = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c833
join("-"	join: " + c834
indexOf(1	indexOf: " + c835
slice(1	slice: " + c836
concat([9]	concat: " + c837
push(7	push: " + c838
pop(	pop: " + c839
sort(	sort: " + c840`,
        (n, a, b) => `function c${n + 833}(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c841
join	join("-"	join: " + c842
indexOf	indexOf(1	indexOf: " + c843
slice	slice(1	slice: " + c844
concat	concat([9]	concat: " + c845
push	push(7	push: " + c846
pop	pop(	pop: " + c847
sort	sort(	sort: " + c848`,
        (n, a, b, c) => `function c${n + 841}(): string {
    const a: any = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c849
join("-"	join: " + c850
indexOf(1	indexOf: " + c851
slice(1	slice: " + c852
concat([9]	concat: " + c853
push(7	push: " + c854
pop(	pop: " + c855
sort(	sort: " + c856`,
        (n, a, b) => `function c${n + 849}(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c857
join	join("-"	join: " + c858
indexOf	indexOf(1	indexOf: " + c859
slice	slice(1	slice: " + c860
concat	concat([9]	concat: " + c861
push	push(7	push: " + c862
pop	pop(	pop: " + c863
sort	sort(	sort: " + c864`,
        (n, a, b, c) => `function c${n + 857}(): string {
    const a: any = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c865
join("-"	join: " + c866
indexOf(1	indexOf: " + c867
slice(1	slice: " + c868
concat([9]	concat: " + c869
push(7	push: " + c870
pop(	pop: " + c871
sort(	sort: " + c872`,
        (n, a, b) => `function c${n + 865}(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c873
join	join("-"	join: " + c874
indexOf	indexOf(1	indexOf: " + c875
slice	slice(1	slice: " + c876
concat	concat([9]	concat: " + c877
push	push(7	push: " + c878
pop	pop(	pop: " + c879
sort	sort(	sort: " + c880`,
        (n, a, b, c) => `function c${n + 873}(): string {
    const a: any = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c881
join("-"	join: " + c882
indexOf(1	indexOf: " + c883
slice(1	slice: " + c884
concat([9]	concat: " + c885
push(7	push: " + c886
pop(	pop: " + c887
sort(	sort: " + c888`,
        (n, a, b) => `function c${n + 881}(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c889
join	join("-"	join: " + c890
indexOf	indexOf(1	indexOf: " + c891
slice	slice(1	slice: " + c892
concat	concat([9]	concat: " + c893
push	push(7	push: " + c894
pop	pop(	pop: " + c895
sort	sort(	sort: " + c896`,
        (n, a, b, c) => `function c${n + 889}(): string {
    const a: any = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c897
join("-"	join: " + c898
indexOf(1	indexOf: " + c899
slice(1	slice: " + c900
concat([9]	concat: " + c901
push(7	push: " + c902
pop(	pop: " + c903
sort(	sort: " + c904`,
        (n, a, b) => `function c${n + 897}(): string {
    const a: any = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing ${b}());`,
      ],
      [
        `map((x: number) => x * 2	(a as any).map = () => "its own"	ownMethod map: " + c905	join("-"	(a as any).join = () => "its own"	ownMethod join: " + c906
indexOf(1	(a as any).indexOf = () => "its own"	ownMethod indexOf: " + c907	slice(1	(a as any).slice = () => "its own"	ownMethod slice: " + c908
concat([9]	(a as any).concat = () => "its own"	ownMethod concat: " + c909	push(7	(a as any).push = () => "its own"	ownMethod push: " + c910
pop(	(a as any).pop = () => "its own"	ownMethod pop: " + c911	sort(	(a as any).sort = () => "its own"	ownMethod sort: " + c912
map((x: number) => x * 2	meddlers[yes ? 0 : 2](a, "map")	elsewhere map: " + c913	join("-"	meddlers[yes ? 0 : 2](a, "join")	elsewhere join: " + c914
indexOf(1	meddlers[yes ? 0 : 2](a, "indexOf")	elsewhere indexOf: " + c915	slice(1	meddlers[yes ? 0 : 2](a, "slice")	elsewhere slice: " + c916
concat([9]	meddlers[yes ? 0 : 2](a, "concat")	elsewhere concat: " + c917	push(7	meddlers[yes ? 0 : 2](a, "push")	elsewhere push: " + c918
pop(	meddlers[yes ? 0 : 2](a, "pop")	elsewhere pop: " + c919	sort(	meddlers[yes ? 0 : 2](a, "sort")	elsewhere sort: " + c920
map((x: number) => x * 2	Object.setPrototypeOf(a, otherPrototype("map"))	prototype map: " + c921	join("-"	Object.setPrototypeOf(a, otherPrototype("join"))	prototype join: " + c922
indexOf(1	Object.setPrototypeOf(a, otherPrototype("indexOf"))	prototype indexOf: " + c923	slice(1	Object.setPrototypeOf(a, otherPrototype("slice"))	prototype slice: " + c924
concat([9]	Object.setPrototypeOf(a, otherPrototype("concat"))	prototype concat: " + c925	push(7	Object.setPrototypeOf(a, otherPrototype("push"))	prototype push: " + c926
pop(	Object.setPrototypeOf(a, otherPrototype("pop"))	prototype pop: " + c927	sort(	Object.setPrototypeOf(a, otherPrototype("sort"))	prototype sort: " + c928
map((x: number) => x * 2	Object.freeze(a)	frozen map: " + c929	join("-"	Object.freeze(a)	frozen join: " + c930
indexOf(1	Object.freeze(a)	frozen indexOf: " + c931	slice(1	Object.freeze(a)	frozen slice: " + c932
concat([9]	Object.freeze(a)	frozen concat: " + c933	push(7	Object.freeze(a)	frozen push: " + c934
pop(	Object.freeze(a)	frozen pop: " + c935	sort(	Object.freeze(a)	frozen sort: " + c936
map((x: number) => x * 2	(a as any).extra = 1	harmlessName map: " + c937	join("-"	(a as any).extra = 1	harmlessName join: " + c938
indexOf(1	(a as any).extra = 1	harmlessName indexOf: " + c939	slice(1	(a as any).extra = 1	harmlessName slice: " + c940
concat([9]	(a as any).extra = 1	harmlessName concat: " + c941	push(7	(a as any).extra = 1	harmlessName push: " + c942
pop(	(a as any).extra = 1	harmlessName pop: " + c943	sort(	(a as any).extra = 1	harmlessName sort: " + c944
map((x: number) => x * 2	holder.it = a; alterWhatIsHeld("map")	held map: " + c945	join("-"	holder.it = a; alterWhatIsHeld("join")	held join: " + c946
indexOf(1	holder.it = a; alterWhatIsHeld("indexOf")	held indexOf: " + c947	slice(1	holder.it = a; alterWhatIsHeld("slice")	held slice: " + c948
concat([9]	holder.it = a; alterWhatIsHeld("concat")	held concat: " + c949	push(7	holder.it = a; alterWhatIsHeld("push")	held push: " + c950
pop(	holder.it = a; alterWhatIsHeld("pop")	held pop: " + c951	sort(	holder.it = a; alterWhatIsHeld("sort")	held sort: " + c952`,
        (n, a, b, c, d, e, f) => `function c${2 * n + 905}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { ${b}; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ${c}());
function c${2 * n + 906}(): string {
    const a: any = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.${d}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { ${e}; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ${f}());`,
      ],
      [
        `map((x: number) => x * 2	map	map: " + c953
join("-"	join	join: " + c954
indexOf(1	indexOf	indexOf: " + c955
slice(1	slice	slice: " + c956
concat([9]	concat	concat: " + c957
push(7	push	push: " + c958
pop(	pop	pop: " + c959
sort(	sort	sort: " + c960`,
        (n, a, b, c) => `function c${n + 953}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).${b} = () => "its own";
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map	map: " + c961
join("-"	join	join: " + c962
indexOf(1	indexOf	indexOf: " + c963
slice(1	slice	slice: " + c964
concat([9]	concat	concat: " + c965
push(7	push	push: " + c966
pop(	pop	pop: " + c967
sort(	sort	sort: " + c968`,
        (n, a, b, c) => `function c${n + 961}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "${b}");
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere ${c}());`,
      ],
      [
        `map((x: number) => x * 2	setPrototypeOf(a, otherPrototype("map")	prototype map: " + c969
join("-"	setPrototypeOf(a, otherPrototype("join")	prototype join: " + c970
indexOf(1	setPrototypeOf(a, otherPrototype("indexOf")	prototype indexOf: " + c971
slice(1	setPrototypeOf(a, otherPrototype("slice")	prototype slice: " + c972
concat([9]	setPrototypeOf(a, otherPrototype("concat")	prototype concat: " + c973
push(7	setPrototypeOf(a, otherPrototype("push")	prototype push: " + c974
pop(	setPrototypeOf(a, otherPrototype("pop")	prototype pop: " + c975
sort(	setPrototypeOf(a, otherPrototype("sort")	prototype sort: " + c976
map((x: number) => x * 2	freeze(a	frozen map: " + c977
join("-"	freeze(a	frozen join: " + c978
indexOf(1	freeze(a	frozen indexOf: " + c979
slice(1	freeze(a	frozen slice: " + c980
concat([9]	freeze(a	frozen concat: " + c981
push(7	freeze(a	frozen push: " + c982
pop(	freeze(a	frozen pop: " + c983
sort(	freeze(a	frozen sort: " + c984`,
        (n, a, b, c) => `function c${n + 969}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.${b});
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c985
join("-"	join: " + c986
indexOf(1	indexOf: " + c987
slice(1	slice: " + c988
concat([9]	concat: " + c989
push(7	push: " + c990
pop(	pop: " + c991
sort(	sort: " + c992`,
        (n, a, b) => `function c${n + 985}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName ${b}());`,
      ],
      [
        `map((x: number) => x * 2	map	map: " + c993
join("-"	join	join: " + c994
indexOf(1	indexOf	indexOf: " + c995
slice(1	slice	slice: " + c996
concat([9]	concat	concat: " + c997
push(7	push	push: " + c998
pop(	pop	pop: " + c999
sort(	sort	sort: " + c1000`,
        (n, a, b, c) => `function c${n + 993}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: any = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("${b}");
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held ${c}());`,
      ],
      `
function restOf(...a: any[]): string { let r: unknown; try { r = a.map((x: number) => x + 1); } catch (e) { r = thrown(e); } return show(r); }
function restAltered(...a: any[]): string { (a as any).map = () => "its own"; let r: unknown; try { r = a.map((x: number) => x + 1); } catch (e) { r = thrown(e); } return show(r); }
lines.push("rest: " + restOf(1, 2, 3) + " " + restAltered(1, 2, 3));
async function acrossAwait(): Promise<string> { const a: any = [3, 1, 2]; await null; const first = show(a.map((x: number) => x * 2)); holder.it = a; await null; alterWhatIsHeld("map"); await null; let r: unknown; try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); } return first + " " + show(r); }
function* acrossYield(): Generator<string> { const a: any = [3, 1, 2]; yield show(a.map((x: number) => x * 2)); holder.it = a; yield "held"; let r: unknown; try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); } yield show(r); }
const steps = acrossYield(); lines.push("yield: " + steps.next().value + " " + steps.next().value); alterWhatIsHeld("map"); lines.push("yield: " + steps.next().value);
`,
      [
        `s.has(1)	has: " + c1001
s.add(3).size	add: " + c1002
s.delete(1)	delete: " + c1003
s.size	size: " + c1004
s.forEach((x: number) => { sum += x; })	forEach: " + c1005
[...s.values()]	values: " + c1006
s.clear()	clear: " + c1007`,
        (n, a, b) => `function c${n + 1001}(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing ${b}());`,
      ],
      [
        `has	s.has(1)	has: " + c1008
add	s.add(3).size	add: " + c1009
delete	s.delete(1)	delete: " + c1010
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1011
values	[...s.values()]	values: " + c1012
clear	s.clear()	clear: " + c1013`,
        (n, a, b, c) => `function c${n + 1008}(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).${a} = () => "its own";
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set ownMethod ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1014
add	s.add(3).size	add: " + c1015
delete	s.delete(1)	delete: " + c1016
size	s.size	size: " + c1017
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1018
values	[...s.values()]	values: " + c1019
clear	s.clear()	clear: " + c1020`,
        (n, a, b, c) => `function c${n + 1014}(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { ${a}: function () { return "of another prototype"; } });
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1021
add	s.add(3).size	add: " + c1022
delete	s.delete(1)	delete: " + c1023
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1024
values	[...s.values()]	values: " + c1025
clear	s.clear()	clear: " + c1026`,
        (n, a, b, c) => `function c${n + 1021}(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "${a}");
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set elsewhere ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1027
add	s.add(3).size	add: " + c1028
delete	s.delete(1)	delete: " + c1029
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1030
values	[...s.values()]	values: " + c1031
clear	s.clear()	clear: " + c1032`,
        (n, a, b, c) => `function c${n + 1027}(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("${a}");
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set held ${c}());`,
      ],
      [
        `s.has(1)	has: " + c1033
s.add(3).size	add: " + c1034
s.delete(1)	delete: " + c1035
s.size	size: " + c1036
s.forEach((x: number) => { sum += x; })	forEach: " + c1037
[...s.values()]	values: " + c1038
s.clear()	clear: " + c1039`,
        (n, a, b) => `function c${n + 1033}(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen ${b}());`,
      ],
      [
        `s.has(1)	has: " + c1040
s.add(3).size	add: " + c1041
s.delete(1)	delete: " + c1042
s.size	size: " + c1043
s.forEach((x: number) => { sum += x; })	forEach: " + c1044
[...s.values()]	values: " + c1045
s.clear()	clear: " + c1046`,
        (n, a, b) => `function c${n + 1040}(): string {
    const s: any = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName ${b}());`,
      ],
      [
        `s.has(1)	has: " + c1047
s.get(1)	get: " + c1048
s.set(3, 4).size	set: " + c1049
s.delete(1)	delete: " + c1050
s.size	size: " + c1051
s.forEach((x: number) => { sum += x; })	forEach: " + c1052
[...s.keys()]	keys: " + c1053
s.clear()	clear: " + c1054`,
        (n, a, b) => `function c${n + 1047}(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing ${b}());`,
      ],
      [
        `has	s.has(1)	has: " + c1055
get	s.get(1)	get: " + c1056
set	s.set(3, 4).size	set: " + c1057
delete	s.delete(1)	delete: " + c1058
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1059
keys	[...s.keys()]	keys: " + c1060
clear	s.clear()	clear: " + c1061`,
        (n, a, b, c) => `function c${n + 1055}(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).${a} = () => "its own";
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1062
get	s.get(1)	get: " + c1063
set	s.set(3, 4).size	set: " + c1064
delete	s.delete(1)	delete: " + c1065
size	s.size	size: " + c1066
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1067
keys	[...s.keys()]	keys: " + c1068
clear	s.clear()	clear: " + c1069`,
        (n, a, b, c) => `function c${n + 1062}(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { ${a}: function () { return "of another prototype"; } });
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1070
get	s.get(1)	get: " + c1071
set	s.set(3, 4).size	set: " + c1072
delete	s.delete(1)	delete: " + c1073
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1074
keys	[...s.keys()]	keys: " + c1075
clear	s.clear()	clear: " + c1076`,
        (n, a, b, c) => `function c${n + 1070}(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "${a}");
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1077
get	s.get(1)	get: " + c1078
set	s.set(3, 4).size	set: " + c1079
delete	s.delete(1)	delete: " + c1080
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1081
keys	[...s.keys()]	keys: " + c1082
clear	s.clear()	clear: " + c1083`,
        (n, a, b, c) => `function c${n + 1077}(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("${a}");
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held ${c}());`,
      ],
      [
        `s.has(1)	has: " + c1084
s.get(1)	get: " + c1085
s.set(3, 4).size	set: " + c1086
s.delete(1)	delete: " + c1087
s.size	size: " + c1088
s.forEach((x: number) => { sum += x; })	forEach: " + c1089
[...s.keys()]	keys: " + c1090
s.clear()	clear: " + c1091`,
        (n, a, b) => `function c${n + 1084}(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen ${b}());`,
      ],
      [
        `s.has(1)	has: " + c1092
s.get(1)	get: " + c1093
s.set(3, 4).size	set: " + c1094
s.delete(1)	delete: " + c1095
s.size	size: " + c1096
s.forEach((x: number) => { sum += x; })	forEach: " + c1097
[...s.keys()]	keys: " + c1098
s.clear()	clear: " + c1099`,
        (n, a, b) => `function c${n + 1092}(): string {
    const s: any = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName ${b}());`,
      ],
      [
        `has(holder)	has: " + c1100
get(holder)	get: " + c1101
set(given, 4) === s	set: " + c1102
delete(holder)	delete: " + c1103`,
        (n, a, b) => `function c${n + 1100}(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap nothing ${b}());`,
      ],
      [
        `has	has(holder)	has: " + c1104
get	get(holder)	get: " + c1105
set	set(given, 4) === s	set: " + c1106
delete	delete(holder)	delete: " + c1107`,
        (n, a, b, c) => `function c${n + 1104}(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).${a} = () => "its own";
    try { r = s.${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap ownMethod ${c}());`,
      ],
      [
        `has	has(holder)	has: " + c1108
get	get(holder)	get: " + c1109
set	set(given, 4) === s	set: " + c1110
delete	delete(holder)	delete: " + c1111`,
        (n, a, b, c) => `function c${n + 1108}(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { ${a}: function () { return "of another prototype"; } });
    try { r = s.${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap prototype ${c}());`,
      ],
      [
        `has	has(holder)	has: " + c1112
get	get(holder)	get: " + c1113
set	set(given, 4) === s	set: " + c1114
delete	delete(holder)	delete: " + c1115`,
        (n, a, b, c) => `function c${n + 1112}(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "${a}");
    try { r = s.${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap elsewhere ${c}());`,
      ],
      [
        `has	has(holder)	has: " + c1116
get	get(holder)	get: " + c1117
set	set(given, 4) === s	set: " + c1118
delete	delete(holder)	delete: " + c1119`,
        (n, a, b, c) => `function c${n + 1116}(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("${a}");
    try { r = s.${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap held ${c}());`,
      ],
      [
        `has(holder)	has: " + c1120
get(holder)	get: " + c1121
set(given, 4) === s	set: " + c1122
delete(holder)	delete: " + c1123`,
        (n, a, b) => `function c${n + 1120}(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap frozen ${b}());`,
      ],
      [
        `has(holder)	has: " + c1124
get(holder)	get: " + c1125
set(given, 4) === s	set: " + c1126
delete(holder)	delete: " + c1127`,
        (n, a, b) => `function c${n + 1124}(): string {
    const s: any = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap harmlessName ${b}());`,
      ],
      [
        `getTime	getTime: " + c1128
getUTCFullYear	getUTCFullYear: " + c1129
toISOString	toISOString: " + c1130
valueOf	valueOf: " + c1131`,
        (n, a, b) => `function c${n + 1128}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date nothing ${b}());`,
      ],
      [
        `getTime	getTime: " + c1132
getUTCFullYear	getUTCFullYear: " + c1133
toISOString	toISOString: " + c1134
valueOf	valueOf: " + c1135`,
        (n, a, b) => `function c${n + 1132}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).${a} = () => "its own";
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ownMethod ${b}());`,
      ],
      [
        `getTime	getTime: " + c1136
getUTCFullYear	getUTCFullYear: " + c1137
toISOString	toISOString: " + c1138
valueOf	valueOf: " + c1139`,
        (n, a, b) => `function c${n + 1136}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { ${a}: function () { return "of another prototype"; } });
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date prototype ${b}());`,
      ],
      [
        `meddlers[yes ? 0 : 2](s, 	elsewhere getTime: " + c1140	elsewhere getUTCFullYear: " + c1141	elsewhere toISOString: " + c1142	elsewhere valueOf: " + c1143
holder.it = s; alterWhatIsHeld(	held getTime: " + c1144	held getUTCFullYear: " + c1145	held toISOString: " + c1146	held valueOf: " + c1147`,
        (n, a, b, c, d, e) => `function c${4 * n + 1140}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    ${a}"getTime");
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ${b}());
function c${4 * n + 1141}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    ${a}"getUTCFullYear");
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ${c}());
function c${4 * n + 1142}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    ${a}"toISOString");
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ${d}());
function c${4 * n + 1143}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    ${a}"valueOf");
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ${e}());`,
      ],
      [
        `getTime	getTime: " + c1148
getUTCFullYear	getUTCFullYear: " + c1149
toISOString	toISOString: " + c1150
valueOf	valueOf: " + c1151`,
        (n, a, b) => `function c${n + 1148}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date frozen ${b}());`,
      ],
      [
        `getTime	getTime: " + c1152
getUTCFullYear	getUTCFullYear: " + c1153
toISOString	toISOString: " + c1154
valueOf	valueOf: " + c1155`,
        (n, a, b) => `function c${n + 1152}(): string {
    const s: any = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date harmlessName ${b}());`,
      ],
      `function c1156(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing test: " + c1156());
function c1157(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing exec: " + c1157());
function c1158(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing toString: " + c1158());
function c1159(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).test = () => "its own";
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod test: " + c1159());
function c1160(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).exec = () => "its own";
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod exec: " + c1160());
function c1161(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).toString = () => "its own";
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod toString: " + c1161());
function c1162(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { test: function () { return "of another prototype"; } });
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp prototype test: " + c1162());
function c1163(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { exec: function () { return "of another prototype"; } });
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp prototype exec: " + c1163());
function c1164(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { toString: function () { return "of another prototype"; } });`,
      [
        `prototype toString: " + c1164	meddlers[yes ? 0 : 2](s, 	elsewhere test: " + c1165	elsewhere exec: " + c1166
elsewhere toString: " + c1167	holder.it = s; alterWhatIsHeld(	held test: " + c1168	held exec: " + c1169`,
        (n, a, b, c, d) => `    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ${a}());
function c${3 * n + 1165}(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    ${b}"test");
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ${c}());
function c${3 * n + 1166}(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    ${b}"exec");
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ${d}());
function c${3 * n + 1167}(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    ${b}"toString");`,
      ],
      `    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp held toString: " + c1170());
function c1171(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen test: " + c1171());
function c1172(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen exec: " + c1172());
function c1173(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen toString: " + c1173());
function c1174(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName test: " + c1174());
function c1175(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName exec: " + c1175());
function c1176(): string {
    const s: any = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName toString: " + c1176());
acrossAwait().then(text => { lines.push("await: " + text); console.log(lines.join("\\n")); });
`,
    ),
    "method-calls-on-unescaped-receivers.ts": text(
      `
function show(v: unknown): string {
    if (Array.isArray(v)) {
        const parts: string[] = [];
        for (let i = 0; i < v.length && i < 14; i++) parts.push(i in v ? show(v[i]) : "hole");
        const own = Object.getOwnPropertyNames(v).filter(k => k !== "length" && !/^\\d+$/.test(k));
        return "[" + parts.join(",") + (v.length > 14 ? ",.. " + v.length : "") + "]" + (own.length ? "{" + own.join(",") + "}" : "") + (Object.getPrototypeOf(v) === Array.prototype ? "" : "^") + (Object.isFrozen(v) ? "F" : Object.isSealed(v) ? "S" : Object.isExtensible(v) ? "" : "X");
    }
    if (typeof v === "function") return "function";
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "object") return Object.prototype.toString.call(v);
    if (typeof v === "number" && v === 0 && 1 / v < 0) return "-0";
    return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function thrown(e: unknown): string { return "throws " + (e instanceof Error ? e.constructor.name : show(e)); }
const yes: boolean = Date.now() > 0;
const no: boolean = Date.now() < 0;
const holder: { it: any } = { it: undefined };
const given: number[] = [3, 1, 2];
function otherPrototype(m: string): any { const p: any = Object.create(Array.prototype); p[m] = function () { return "of another prototype"; }; return p; }
class Heir extends Array<number> { }
const meddlers: Array<(x: any, m: string) => void> = [
    (x, m) => { x[m] = () => "its own, given elsewhere"; },
    (x, m) => { Object.setPrototypeOf(x, otherPrototype(m)); },
    (x, m) => { },
];
function alterWhatIsHeld(m: string): void { holder.it[m] = () => "its own, through the holder"; }
function rest(...all: number[]): number[] { return all; }
const lines: string[] = [];
let memoized: number[] | undefined;
let calls = 0;
function fill(out: number[]): void { }
function fresh(): number[] { const out: number[] = []; for (const x of given) { calls++; if (x > 0) out.push(x); else if (x < -5) out.push(-x); } return out; }
function freshLiteral(): number[] { calls++; if (no) return [9, 9]; const out: number[] = [3, 1, 2]; for (let i = 0; i < 2; i++) calls += out.length; return out; }
function freshSpread(): number[] { calls++; for (let i = 0; i < 2; i++) calls += i; return [...given]; }
function freshKeys(): number[] { calls++; for (let i = 0; i < 2; i++) calls += i; return Object.values({ a: 3, b: 1, c: 2 }); }
function throughFresh(): number[] { calls++; for (let i = 0; i < 2; i++) calls += i; return fresh(); }
function recursive(n: number): number[] { calls++; if (n > 0) return recursive(n - 1); const out: number[] = []; for (const x of given) out.push(x); return out; }
function kept(): number[] { const out: number[] = []; for (const x of given) { calls++; out.push(x); } holder.it = out; return out; }
function keptOnOneRoad(): number[] { const out: number[] = []; for (const x of given) { calls++; out.push(x); } if (yes) holder.it = out; return out; }
function keptByClosure(): number[] { const out: number[] = []; for (const x of given) { calls++; out.push(x); } holder.it = { set map(f: unknown) { (out as any).map = f; }, set join(f: unknown) { (out as any).join = f; }, set push(f: unknown) { (out as any).push = f; } }; return out; }
function handedOn(): number[] { const out: number[] = []; for (const x of given) { calls++; out.push(x); } meddlers[yes ? 2 : 0](out, "x"); return out; }
function memo(): number[] { calls++; for (let i = 0; i < 2; i++) calls += i; if (!memoized) memoized = [3, 1, 2]; holder.it = memoized; return memoized; }
function oneOfTwo(): number[] { calls++; for (let i = 0; i < 2; i++) calls += i; if (yes) { holder.it = given2; return given2; } return [3, 1, 2]; }
function alteredInside(): number[] { const out: number[] = []; for (const x of given) { calls++; out.push(x); } (out as any).map = () => "its own, from the maker"; (out as any).join = () => "its own, from the maker"; return out; }
function anHeir(): number[] { calls++; for (let i = 0; i < 2; i++) calls += i; const out = new Heir(); out.push(3, 1, 2); return out; }
function frozenInside(): number[] { const out: number[] = []; for (const x of given) { calls++; out.push(x); } return Object.freeze(out) as number[]; }
const given2: number[] = [3, 1, 2];
`,
      [
        `map((x: number) => x * 2	map: " + c1
join("-"	join: " + c2
indexOf(1	indexOf: " + c3
slice(1	slice: " + c4
concat([9]	concat: " + c5
push(7	push: " + c6
pop(	pop: " + c7
sort(	sort: " + c8`,
        (n, a, b) => `function c${n + 1}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing ${b}());`,
      ],
      [
        `.map = () => "its own	map((x: number) => x * 2	 map: " + c9
.join = () => "its own	join("-"	 join: " + c10
.indexOf = () => "its own	indexOf(1	 indexOf: " + c11
.slice = () => "its own	slice(1	 slice: " + c12
.concat = () => "its own	concat([9]	 concat: " + c13
.push = () => "its own	push(7	 push: " + c14
.pop = () => "its own	pop(	 pop: " + c15
.sort = () => "its own	sort(	 sort: " + c16
["map"] = () => "its own by key	map((x: number) => x * 2	ByKey map: " + c17
["join"] = () => "its own by key	join("-"	ByKey join: " + c18
["indexOf"] = () => "its own by key	indexOf(1	ByKey indexOf: " + c19
["slice"] = () => "its own by key	slice(1	ByKey slice: " + c20
["concat"] = () => "its own by key	concat([9]	ByKey concat: " + c21
["push"] = () => "its own by key	push(7	ByKey push: " + c22
["pop"] = () => "its own by key	pop(	ByKey pop: " + c23
["sort"] = () => "its own by key	sort(	ByKey sort: " + c24`,
        (n, a, b, c) => `function c${n + 9}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a}";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c25
join	join("-"	join: " + c26
indexOf	indexOf(1	indexOf: " + c27
slice	slice(1	slice: " + c28
concat	concat([9]	concat: " + c29
push	push(7	push: " + c30
pop	pop(	pop: " + c31
sort	sort(	sort: " + c32`,
        (n, a, b, c) => `function c${n + 25}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    const key: string = yes ? "${a}" : "x"; (a as any)[key] = () => "its own by a key that is not known";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethodByVariableKey ${c}());`,
      ],
      [
        `Object.setPrototypeOf(a, otherPrototype("map	map((x: number) => x * 2	 map: " + c33	Object.setPrototypeOf(a, otherPrototype("join	join("-"	 join: " + c34	Object.setPrototypeOf(a, otherPrototype("indexOf	indexOf(1	 indexOf: " + c35	Object.setPrototypeOf(a, otherPrototype("slice	lice(1	 slice: " + c36
Object.setPrototypeOf(a, otherPrototype("concat	concat([9]	 concat: " + c37	Object.setPrototypeOf(a, otherPrototype("push	push(7	 push: " + c38	Object.setPrototypeOf(a, otherPrototype("pop	pop(	 pop: " + c39	Object.setPrototypeOf(a, otherPrototype("sort	ort(	 sort: " + c40
Reflect.setPrototypeOf(a, otherPrototype("map	map((x: number) => x * 2	ByReflect map: " + c41	Reflect.setPrototypeOf(a, otherPrototype("join	join("-"	ByReflect join: " + c42	Reflect.setPrototypeOf(a, otherPrototype("indexOf	indexOf(1	ByReflect indexOf: " + c43	Reflect.setPrototypeOf(a, otherPrototype("slice	lice(1	ByReflect slice: " + c44`,
        (n, a, b, c, d, e, f, g, h, i, j, k, l) => `function c${4 * n + 33}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    ${a}"));
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype${c}());
function c${4 * n + 34}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    ${d}"));
    try { r = a.${e}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype${f}());
function c${4 * n + 35}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    ${g}"));
    try { r = a.${h}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype${i}());
function c${4 * n + 36}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    ${j}"));
    try { r = a.s${k}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototype${l}());`,
      ],
      [
        `concat	concat([9]	concat: " + c45
push	push(7	push: " + c46
pop	pop(	pop: " + c47
sort	sort(	sort: " + c48`,
        (n, a, b, c) => `function c${n + 45}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    Reflect.setPrototypeOf(a, otherPrototype("${a}"));
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByReflect ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c49
join	join("-"	join: " + c50
indexOf	indexOf(1	indexOf: " + c51
slice	slice(1	slice: " + c52
concat	concat([9]	concat: " + c53
push	push(7	push: " + c54
pop	pop(	pop: " + c55
sort	sort(	sort: " + c56`,
        (n, a, b, c) => `function c${n + 49}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).__proto__ = otherPrototype("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal prototypeByName ${c}());`,
      ],
      [
        `setPrototypeOf(a, null	map((x: number) => x * 2	noPrototype map: " + c57	setPrototypeOf(a, null	join("-"	noPrototype join: " + c58	setPrototypeOf(a, null	indexOf(1	noPrototype indexOf: " + c59
setPrototypeOf(a, null	slice(1	noPrototype slice: " + c60	setPrototypeOf(a, null	concat([9]	noPrototype concat: " + c61	setPrototypeOf(a, null	push(7	noPrototype push: " + c62
setPrototypeOf(a, null	pop(	noPrototype pop: " + c63	setPrototypeOf(a, null	sort(	noPrototype sort: " + c64	defineProperty(a, "map", { value: () => "defined", configurable: true }	map((x: number) => x * 2	defined map: " + c65
defineProperty(a, "join", { value: () => "defined", configurable: true }	join("-"	defined join: " + c66	defineProperty(a, "indexOf", { value: () => "defined", configurable: true }	indexOf(1	defined indexOf: " + c67	defineProperty(a, "slice", { value: () => "defined", configurable: true }	slice(1	defined slice: " + c68
defineProperty(a, "concat", { value: () => "defined", configurable: true }	concat([9]	defined concat: " + c69	defineProperty(a, "push", { value: () => "defined", configurable: true }	push(7	defined push: " + c70	defineProperty(a, "pop", { value: () => "defined", configurable: true }	pop(	defined pop: " + c71
defineProperty(a, "sort", { value: () => "defined", configurable: true }	sort(	defined sort: " + c72	defineProperty(a, "map", { get: () => () => "by a getter", configurable: true }	map((x: number) => x * 2	definedGetter map: " + c73	defineProperty(a, "join", { get: () => () => "by a getter", configurable: true }	join("-"	definedGetter join: " + c74
defineProperty(a, "indexOf", { get: () => () => "by a getter", configurable: true }	indexOf(1	definedGetter indexOf: " + c75	defineProperty(a, "slice", { get: () => () => "by a getter", configurable: true }	slice(1	definedGetter slice: " + c76	defineProperty(a, "concat", { get: () => () => "by a getter", configurable: true }	concat([9]	definedGetter concat: " + c77
defineProperty(a, "push", { get: () => () => "by a getter", configurable: true }	push(7	definedGetter push: " + c78	defineProperty(a, "pop", { get: () => () => "by a getter", configurable: true }	pop(	definedGetter pop: " + c79	defineProperty(a, "sort", { get: () => () => "by a getter", configurable: true }	sort(	definedGetter sort: " + c80
assign(a, { map: () => "assigned" }	map((x: number) => x * 2	assigned map: " + c81	assign(a, { join: () => "assigned" }	join("-"	assigned join: " + c82	assign(a, { indexOf: () => "assigned" }	indexOf(1	assigned indexOf: " + c83
assign(a, { slice: () => "assigned" }	slice(1	assigned slice: " + c84	assign(a, { concat: () => "assigned" }	concat([9]	assigned concat: " + c85	assign(a, { push: () => "assigned" }	push(7	assigned push: " + c86
assign(a, { pop: () => "assigned" }	pop(	assigned pop: " + c87	assign(a, { sort: () => "assigned" }	sort(	assigned sort: " + c88	defineProperty(a, 0, { get: () => 42, configurable: true }	map((x: number) => x * 2	getterElement map: " + c89
defineProperty(a, 0, { get: () => 42, configurable: true }	join("-"	getterElement join: " + c90	defineProperty(a, 0, { get: () => 42, configurable: true }	indexOf(1	getterElement indexOf: " + c91	defineProperty(a, 0, { get: () => 42, configurable: true }	slice(1	getterElement slice: " + c92
defineProperty(a, 0, { get: () => 42, configurable: true }	concat([9]	getterElement concat: " + c93	defineProperty(a, 0, { get: () => 42, configurable: true }	push(7	getterElement push: " + c94	defineProperty(a, 0, { get: () => 42, configurable: true }	pop(	getterElement pop: " + c95
defineProperty(a, 0, { get: () => 42, configurable: true }	sort(	getterElement sort: " + c96	freeze(a	map((x: number) => x * 2	frozen map: " + c97	freeze(a	join("-"	frozen join: " + c98
freeze(a	indexOf(1	frozen indexOf: " + c99	freeze(a	slice(1	frozen slice: " + c100	freeze(a	concat([9]	frozen concat: " + c101
freeze(a	push(7	frozen push: " + c102	freeze(a	pop(	frozen pop: " + c103	freeze(a	sort(	frozen sort: " + c104
seal(a	map((x: number) => x * 2	sealed map: " + c105	seal(a	join("-"	sealed join: " + c106	seal(a	indexOf(1	sealed indexOf: " + c107
seal(a	slice(1	sealed slice: " + c108	seal(a	concat([9]	sealed concat: " + c109	seal(a	push(7	sealed push: " + c110
seal(a	pop(	sealed pop: " + c111	seal(a	sort(	sealed sort: " + c112	preventExtensions(a	map((x: number) => x * 2	notExtensible map: " + c113
preventExtensions(a	join("-"	notExtensible join: " + c114	preventExtensions(a	indexOf(1	notExtensible indexOf: " + c115	preventExtensions(a	slice(1	notExtensible slice: " + c116
preventExtensions(a	concat([9]	notExtensible concat: " + c117	preventExtensions(a	push(7	notExtensible push: " + c118	preventExtensions(a	pop(	notExtensible pop: " + c119
preventExtensions(a	sort(	notExtensible sort: " + c120	defineProperty(a, "length", { writable: false }	map((x: number) => x * 2	lengthReadOnly map: " + c121	defineProperty(a, "length", { writable: false }	join("-"	lengthReadOnly join: " + c122
defineProperty(a, "length", { writable: false }	indexOf(1	lengthReadOnly indexOf: " + c123	defineProperty(a, "length", { writable: false }	slice(1	lengthReadOnly slice: " + c124	defineProperty(a, "length", { writable: false }	concat([9]	lengthReadOnly concat: " + c125
defineProperty(a, "length", { writable: false }	push(7	lengthReadOnly push: " + c126	defineProperty(a, "length", { writable: false }	pop(	lengthReadOnly pop: " + c127	defineProperty(a, "length", { writable: false }	sort(	lengthReadOnly sort: " + c128`,
        (n, a, b, c, d, e, f, g, h, i) => `function c${3 * n + 57}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.${a});
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${3 * n + 58}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.${d});
    try { r = a.${e}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${f}());
function c${3 * n + 59}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    Object.${g});
    try { r = a.${h}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${i}());`,
      ],
      [
        `1	map((x: number) => x * 2	shorter map: " + c129
1	join("-"	shorter join: " + c130
1	indexOf(1	shorter indexOf: " + c131
1	slice(1	shorter slice: " + c132
1	concat([9]	shorter concat: " + c133
1	push(7	shorter push: " + c134
1	pop(	shorter pop: " + c135
1	sort(	shorter sort: " + c136
6	map((x: number) => x * 2	longer map: " + c137
6	join("-"	longer join: " + c138
6	indexOf(1	longer indexOf: " + c139
6	slice(1	longer slice: " + c140
6	concat([9]	longer concat: " + c141
6	push(7	longer push: " + c142
6	pop(	longer pop: " + c143
6	sort(	longer sort: " + c144`,
        (n, a, b, c) => `function c${n + 129}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.length = ${a};
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c145
join("-"	join: " + c146
indexOf(1	indexOf: " + c147
slice(1	slice: " + c148
concat([9]	concat: " + c149
push(7	push: " + c150
pop(	pop: " + c151
sort(	sort: " + c152`,
        (n, a, b) => `function c${n + 145}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[9] = 7;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal farElement ${b}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c153
join("-"	join: " + c154
indexOf(1	indexOf: " + c155
slice(1	slice: " + c156
concat([9]	concat: " + c157
push(7	push: " + c158
pop(	pop: " + c159
sort(	sort: " + c160`,
        (n, a, b) => `function c${n + 153}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    delete a[1];
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal deleted ${b}());`,
      ],
      [
        `.extra = 1	map((x: number) => x * 2	harmlessName map: " + c161	join("-"	harmlessName join: " + c162
.extra = 1	indexOf(1	harmlessName indexOf: " + c163	slice(1	harmlessName slice: " + c164
.extra = 1	concat([9]	harmlessName concat: " + c165	push(7	harmlessName push: " + c166
.extra = 1	pop(	harmlessName pop: " + c167	sort(	harmlessName sort: " + c168
[-1] = 5	map((x: number) => x * 2	negativeKey map: " + c169	join("-"	negativeKey join: " + c170
[-1] = 5	indexOf(1	negativeKey indexOf: " + c171	slice(1	negativeKey slice: " + c172
[-1] = 5	concat([9]	negativeKey concat: " + c173	push(7	negativeKey push: " + c174
[-1] = 5	pop(	negativeKey pop: " + c175	sort(	negativeKey sort: " + c176
[1.5] = 5	map((x: number) => x * 2	fractionKey map: " + c177	join("-"	fractionKey join: " + c178
[1.5] = 5	indexOf(1	fractionKey indexOf: " + c179	slice(1	fractionKey slice: " + c180
[1.5] = 5	concat([9]	fractionKey concat: " + c181	push(7	fractionKey push: " + c182
[1.5] = 5	pop(	fractionKey pop: " + c183	sort(	fractionKey sort: " + c184`,
        (n, a, b, c, d, e) => `function c${2 * n + 161}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a};
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${2 * n + 162}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a};
    try { r = a.${d}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${e}());`,
      ],
      [
        `0 : 2](a, "map	map((x: number) => x * 2	 map: " + c185	0 : 2](a, "join	join("-"	 join: " + c186
0 : 2](a, "indexOf	indexOf(1	 indexOf: " + c187	0 : 2](a, "slice	slice(1	 slice: " + c188
0 : 2](a, "concat	concat([9]	 concat: " + c189	0 : 2](a, "push	push(7	 push: " + c190
0 : 2](a, "pop	pop(	 pop: " + c191	0 : 2](a, "sort	sort(	 sort: " + c192
1 : 2](a, "map	map((x: number) => x * 2	Prototype map: " + c193	1 : 2](a, "join	join("-"	Prototype join: " + c194
1 : 2](a, "indexOf	indexOf(1	Prototype indexOf: " + c195	1 : 2](a, "slice	slice(1	Prototype slice: " + c196
1 : 2](a, "concat	concat([9]	Prototype concat: " + c197	1 : 2](a, "push	push(7	Prototype push: " + c198
1 : 2](a, "pop	pop(	Prototype pop: " + c199	1 : 2](a, "sort	sort(	Prototype sort: " + c200
2 : 0](a, "map	map((x: number) => x * 2	Nothing map: " + c201	2 : 0](a, "join	join("-"	Nothing join: " + c202
2 : 0](a, "indexOf	indexOf(1	Nothing indexOf: " + c203	2 : 0](a, "slice	slice(1	Nothing slice: " + c204
2 : 0](a, "concat	concat([9]	Nothing concat: " + c205	2 : 0](a, "push	push(7	Nothing push: " + c206
2 : 0](a, "pop	pop(	Nothing pop: " + c207	2 : 0](a, "sort	sort(	Nothing sort: " + c208`,
        (n, a, b, c, d, e, f) => `function c${2 * n + 185}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? ${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere${c}());
function c${2 * n + 186}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    meddlers[yes ? ${d}");
    try { r = a.${e}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elsewhere${f}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c209
join	join("-"	join: " + c210
indexOf	indexOf(1	indexOf: " + c211
slice	slice(1	slice: " + c212
concat	concat([9]	concat: " + c213
push	push(7	push: " + c214
pop	pop(	pop: " + c215
sort	sort(	sort: " + c216`,
        (n, a, b, c) => `function c${n + 209}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    holder.it = a; alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal held ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c217
join	join("-"	join: " + c218
indexOf	indexOf(1	indexOf: " + c219
slice	slice(1	slice: " + c220
concat	concat([9]	concat: " + c221
push	push(7	push: " + c222
pop	pop(	pop: " + c223
sort	sort(	sort: " + c224`,
        (n, a, b, c) => `function c${n + 217}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    const alter = () => { (a as any).${a} = () => "its own, by a closure"; }; alter();
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal closure ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c225
join	join("-"	join: " + c226
indexOf	indexOf(1	indexOf: " + c227
slice	slice(1	slice: " + c228
concat	concat([9]	concat: " + c229
push	push(7	push: " + c230
pop	pop(	pop: " + c231
sort	sort(	sort: " + c232`,
        (n, a, b, c) => `function c${n + 225}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.forEach((x: number, i: number, all: any) => { all.${a} = () => "its own, by a callback"; });
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callback ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c233
join	join("-"	join: " + c234
indexOf	indexOf(1	indexOf: " + c235
slice	slice(1	slice: " + c236
concat	concat([9]	concat: " + c237
push	push(7	push: " + c238
pop	pop(	pop: " + c239
sort	sort(	sort: " + c240`,
        (n, a, b, c) => `function c${n + 233}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.map((x: number, i: number, all: any) => { all.${a} = () => "its own, by a callback of map"; return x; });
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal callbackOfMap ${c}());`,
      ],
      [
        `.constructor = Heir	map((x: number) => x * 2	species map: " + c241	join("-"	species join: " + c242
.constructor = Heir	indexOf(1	species indexOf: " + c243	slice(1	species slice: " + c244
.constructor = Heir	concat([9]	species concat: " + c245	push(7	species push: " + c246
.constructor = Heir	pop(	species pop: " + c247	sort(	species sort: " + c248
.constructor = { [Symbol.species]: Heir }	map((x: number) => x * 2	speciesObject map: " + c249	join("-"	speciesObject join: " + c250
.constructor = { [Symbol.species]: Heir }	indexOf(1	speciesObject indexOf: " + c251	slice(1	speciesObject slice: " + c252
.constructor = { [Symbol.species]: Heir }	concat([9]	speciesObject concat: " + c253	push(7	speciesObject push: " + c254
.constructor = { [Symbol.species]: Heir }	pop(	speciesObject pop: " + c255	sort(	speciesObject sort: " + c256
[Symbol.isConcatSpreadable] = false	map((x: number) => x * 2	notSpreadable map: " + c257	join("-"	notSpreadable join: " + c258
[Symbol.isConcatSpreadable] = false	indexOf(1	notSpreadable indexOf: " + c259	slice(1	notSpreadable slice: " + c260
[Symbol.isConcatSpreadable] = false	concat([9]	notSpreadable concat: " + c261	push(7	notSpreadable push: " + c262
[Symbol.isConcatSpreadable] = false	pop(	notSpreadable pop: " + c263	sort(	notSpreadable sort: " + c264
[Symbol.iterator] = function* () { yield 99; }	map((x: number) => x * 2	ownIterator map: " + c265	join("-"	ownIterator join: " + c266
[Symbol.iterator] = function* () { yield 99; }	indexOf(1	ownIterator indexOf: " + c267	slice(1	ownIterator slice: " + c268
[Symbol.iterator] = function* () { yield 99; }	concat([9]	ownIterator concat: " + c269	push(7	ownIterator push: " + c270
[Symbol.iterator] = function* () { yield 99; }	pop(	ownIterator pop: " + c271	sort(	ownIterator sort: " + c272`,
        (n, a, b, c, d, e) => `function c${2 * n + 241}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a};
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${2 * n + 242}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any)${a};
    try { r = a.${d}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${e}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c273
join	join("-"	join: " + c274
indexOf	indexOf(1	indexOf: " + c275
slice	slice(1	slice: " + c276
concat	concat([9]	concat: " + c277
push	push(7	push: " + c278
pop	pop(	pop: " + c279
sort	sort(	sort: " + c280`,
        (n, a, b, c) => `function c${n + 273}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (yes) (a as any).${a} = () => "its own, on one road";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifYes ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c281
join	join("-"	join: " + c282
indexOf	indexOf(1	indexOf: " + c283
slice	slice(1	slice: " + c284
concat	concat([9]	concat: " + c285
push	push(7	push: " + c286
pop	pop(	pop: " + c287
sort	sort(	sort: " + c288`,
        (n, a, b, c) => `function c${n + 281}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (no) (a as any).${a} = () => "never";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ifNo ${c}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c289
join	join("-"	join: " + c290
indexOf	indexOf(1	indexOf: " + c291
slice	slice(1	slice: " + c292
concat	concat([9]	concat: " + c293
push	push(7	push: " + c294
pop	pop(	pop: " + c295
sort	sort(	sort: " + c296`,
        (n, a, b, c) => `function c${n + 289}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { (a as any).${a} = () => "its own, in a try"; if (yes) throw new Error("x"); } catch { }
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal inTry ${c}());`,
      ],
      [
        `same: any = a.sort(); same.map = () => "its own, through what sort returns	map((x: number) => x * 2	throughSort map: " + c297	same: any = a.sort(); same.join = () => "its own, through what sort returns	join("-"	throughSort join: " + c298
same: any = a.sort(); same.indexOf = () => "its own, through what sort returns	indexOf(1	throughSort indexOf: " + c299	same: any = a.sort(); same.slice = () => "its own, through what sort returns	slice(1	throughSort slice: " + c300
same: any = a.sort(); same.concat = () => "its own, through what sort returns	concat([9]	throughSort concat: " + c301	same: any = a.sort(); same.push = () => "its own, through what sort returns	push(7	throughSort push: " + c302
same: any = a.sort(); same.pop = () => "its own, through what sort returns	pop(	throughSort pop: " + c303	same: any = a.sort(); same.sort = () => "its own, through what sort returns	sort(	throughSort sort: " + c304
same = a as unknown as { map: unknown }; same.map = () => "its own, through a cast	map((x: number) => x * 2	throughCast map: " + c305	same = a as unknown as { join: unknown }; same.join = () => "its own, through a cast	join("-"	throughCast join: " + c306
same = a as unknown as { indexOf: unknown }; same.indexOf = () => "its own, through a cast	indexOf(1	throughCast indexOf: " + c307	same = a as unknown as { slice: unknown }; same.slice = () => "its own, through a cast	slice(1	throughCast slice: " + c308
same = a as unknown as { concat: unknown }; same.concat = () => "its own, through a cast	concat([9]	throughCast concat: " + c309	same = a as unknown as { push: unknown }; same.push = () => "its own, through a cast	push(7	throughCast push: " + c310
same = a as unknown as { pop: unknown }; same.pop = () => "its own, through a cast	pop(	throughCast pop: " + c311	same = a as unknown as { sort: unknown }; same.sort = () => "its own, through a cast	sort(	throughCast sort: " + c312
box: any[] = [a]; box[0].map = () => "its own, through an array	map((x: number) => x * 2	inArray map: " + c313	box: any[] = [a]; box[0].join = () => "its own, through an array	join("-"	inArray join: " + c314
box: any[] = [a]; box[0].indexOf = () => "its own, through an array	indexOf(1	inArray indexOf: " + c315	box: any[] = [a]; box[0].slice = () => "its own, through an array	slice(1	inArray slice: " + c316
box: any[] = [a]; box[0].concat = () => "its own, through an array	concat([9]	inArray concat: " + c317	box: any[] = [a]; box[0].push = () => "its own, through an array	push(7	inArray push: " + c318
box: any[] = [a]; box[0].pop = () => "its own, through an array	pop(	inArray pop: " + c319	box: any[] = [a]; box[0].sort = () => "its own, through an array	sort(	inArray sort: " + c320
box: any = { a }; box.a.map = () => "its own, through an object	map((x: number) => x * 2	inObject map: " + c321	box: any = { a }; box.a.join = () => "its own, through an object	join("-"	inObject join: " + c322
box: any = { a }; box.a.indexOf = () => "its own, through an object	indexOf(1	inObject indexOf: " + c323	box: any = { a }; box.a.slice = () => "its own, through an object	slice(1	inObject slice: " + c324
box: any = { a }; box.a.concat = () => "its own, through an object	concat([9]	inObject concat: " + c325	box: any = { a }; box.a.push = () => "its own, through an object	push(7	inObject push: " + c326
box: any = { a }; box.a.pop = () => "its own, through an object	pop(	inObject pop: " + c327	box: any = { a }; box.a.sort = () => "its own, through an object	sort(	inObject sort: " + c328`,
        (n, a, b, c, d, e, f) => `function c${2 * n + 297}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    const ${a}";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${2 * n + 298}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    const ${d}";
    try { r = a.${e}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${f}());`,
      ],
      [
        `sum += x;	map((x: number) => x * 2	 map: " + c329
sum += x;	join("-"	 join: " + c330
sum += x;	indexOf(1	 indexOf: " + c331
sum += x;	slice(1	 slice: " + c332
sum += x;	concat([9]	 concat: " + c333
sum += x;	push(7	 push: " + c334
sum += x;	pop(	 pop: " + c335
sum += x;	sort(	 sort: " + c336
{ if (x === 1) (a as any).map = () => "its own, in a loop over it"; }	map((x: number) => x * 2	Altering map: " + c337
{ if (x === 1) (a as any).join = () => "its own, in a loop over it"; }	join("-"	Altering join: " + c338
{ if (x === 1) (a as any).indexOf = () => "its own, in a loop over it"; }	indexOf(1	Altering indexOf: " + c339
{ if (x === 1) (a as any).slice = () => "its own, in a loop over it"; }	slice(1	Altering slice: " + c340
{ if (x === 1) (a as any).concat = () => "its own, in a loop over it"; }	concat([9]	Altering concat: " + c341
{ if (x === 1) (a as any).push = () => "its own, in a loop over it"; }	push(7	Altering push: " + c342
{ if (x === 1) (a as any).pop = () => "its own, in a loop over it"; }	pop(	Altering pop: " + c343
{ if (x === 1) (a as any).sort = () => "its own, in a loop over it"; }	sort(	Altering sort: " + c344`,
        (n, a, b, c) => `function c${n + 329}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    for (const x of a) ${a}
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal iterated${c}());`,
      ],
      [
        `(a as unknown) === (given as unknown)	map((x: number) => x * 2	compared map: " + c345	join("-"	compared join: " + c346
(a as unknown) === (given as unknown)	indexOf(1	compared indexOf: " + c347	slice(1	compared slice: " + c348
(a as unknown) === (given as unknown)	concat([9]	compared concat: " + c349	push(7	compared push: " + c350
(a as unknown) === (given as unknown)	pop(	compared pop: " + c351	sort(	compared sort: " + c352
typeof a === "object"	map((x: number) => x * 2	typeOf map: " + c353	join("-"	typeOf join: " + c354
typeof a === "object"	indexOf(1	typeOf indexOf: " + c355	slice(1	typeOf slice: " + c356
typeof a === "object"	concat([9]	typeOf concat: " + c357	push(7	typeOf push: " + c358
typeof a === "object"	pop(	typeOf pop: " + c359	sort(	typeOf sort: " + c360
"length" in a	map((x: number) => x * 2	inByName map: " + c361	join("-"	inByName join: " + c362
"length" in a	indexOf(1	inByName indexOf: " + c363	slice(1	inByName slice: " + c364
"length" in a	concat([9]	inByName concat: " + c365	push(7	inByName push: " + c366
"length" in a	pop(	inByName pop: " + c367	sort(	inByName sort: " + c368`,
        (n, a, b, c, d, e) => `function c${2 * n + 345}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (${a}) sum++;
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());
function c${2 * n + 346}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (${a}) sum++;
    try { r = a.${d}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${e}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c369
join("-"	join: " + c370
indexOf(1	indexOf: " + c371
slice(1	slice: " + c372
concat([9]	concat: " + c373
push(7	push: " + c374
pop(	pop: " + c375
sort(	sort: " + c376`,
        (n, a, b) => `function c${n + 369}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (a) sum++; if (!a) sum--;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal truthy ${b}());`,
      ],
      [
        `a != null	map((x: number) => x * 2	notNil map: " + c377
a != null	join("-"	notNil join: " + c378
a != null	indexOf(1	notNil indexOf: " + c379
a != null	slice(1	notNil slice: " + c380
a != null	concat([9]	notNil concat: " + c381
a != null	push(7	notNil push: " + c382
a != null	pop(	notNil pop: " + c383
a != null	sort(	notNil sort: " + c384
Array.isArray(a)	map((x: number) => x * 2	isArray map: " + c385
Array.isArray(a)	join("-"	isArray join: " + c386
Array.isArray(a)	indexOf(1	isArray indexOf: " + c387
Array.isArray(a)	slice(1	isArray slice: " + c388
Array.isArray(a)	concat([9]	isArray concat: " + c389
Array.isArray(a)	push(7	isArray push: " + c390
Array.isArray(a)	pop(	isArray pop: " + c391
Array.isArray(a)	sort(	isArray sort: " + c392`,
        (n, a, b, c) => `function c${n + 377}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    if (${a}) sum++;
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());`,
      ],
      [
        `.length	map((x: number) => x * 2	lengthRead map: " + c393
.length	join("-"	lengthRead join: " + c394
.length	indexOf(1	lengthRead indexOf: " + c395
.length	slice(1	lengthRead slice: " + c396
.length	concat([9]	lengthRead concat: " + c397
.length	push(7	lengthRead push: " + c398
.length	pop(	lengthRead pop: " + c399
.length	sort(	lengthRead sort: " + c400
[0]	map((x: number) => x * 2	elementRead map: " + c401
[0]	join("-"	elementRead join: " + c402
[0]	indexOf(1	elementRead indexOf: " + c403
[0]	slice(1	elementRead slice: " + c404
[0]	concat([9]	elementRead concat: " + c405
[0]	push(7	elementRead push: " + c406
[0]	pop(	elementRead pop: " + c407
[0]	sort(	elementRead sort: " + c408`,
        (n, a, b, c) => `function c${n + 393}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    sum += a${a};
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c409
join("-"	join: " + c410
indexOf(1	indexOf: " + c411
slice(1	slice: " + c412
concat([9]	concat: " + c413
push(7	push: " + c414
pop(	pop: " + c415
sort(	sort: " + c416`,
        (n, a, b) => `function c${n + 409}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    a[0] = 5;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal elementStored ${b}());`,
      ],
      [
        `push(4	map((x: number) => x * 2	pushedBefore map: " + c417
push(4	join("-"	pushedBefore join: " + c418
push(4	indexOf(1	pushedBefore indexOf: " + c419
push(4	slice(1	pushedBefore slice: " + c420
push(4	concat([9]	pushedBefore concat: " + c421
push(4	push(7	pushedBefore push: " + c422
push(4	pop(	pushedBefore pop: " + c423
push(4	sort(	pushedBefore sort: " + c424
sort(	map((x: number) => x * 2	sortedBefore map: " + c425
sort(	join("-"	sortedBefore join: " + c426
sort(	indexOf(1	sortedBefore indexOf: " + c427
sort(	slice(1	sortedBefore slice: " + c428
sort(	concat([9]	sortedBefore concat: " + c429
sort(	push(7	sortedBefore push: " + c430
sort(	pop(	sortedBefore pop: " + c431
sort(	sort(	sortedBefore sort: " + c432`,
        (n, a, b, c) => `function c${n + 417}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    a.${a});
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c433
join("-"	join: " + c434
indexOf(1	indexOf: " + c435
slice(1	slice: " + c436
concat([9]	concat: " + c437
push(7	push: " + c438
pop(	pop: " + c439
sort(	sort: " + c440`,
        (n, a, b) => `function c${n + 433}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c441
join	join("-"	join: " + c442
indexOf	indexOf(1	indexOf: " + c443
slice	slice(1	slice: " + c444
concat	concat([9]	concat: " + c445
push	push(7	push: " + c446
pop	pop(	pop: " + c447
sort	sort(	sort: " + c448`,
        (n, a, b, c) => `function c${n + 441}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain literal ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c449
join("-"	join: " + c450
indexOf(1	indexOf: " + c451
slice(1	slice: " + c452
concat([9]	concat: " + c453
push(7	push: " + c454
pop(	pop: " + c455
sort(	sort: " + c456`,
        (n, a, b) => `function c${n + 449}(): string {
    const a: number[] = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c457
join	join("-"	join: " + c458
indexOf	indexOf(1	indexOf: " + c459
slice	slice(1	slice: " + c460
concat	concat([9]	concat: " + c461
push	push(7	push: " + c462
pop	pop(	pop: " + c463
sort	sort(	sort: " + c464`,
        (n, a, b, c) => `function c${n + 457}(): string {
    const a: number[] = []; a.push(3); a.push(1); a.push(2);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain pushed ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c465
join("-"	join: " + c466
indexOf(1	indexOf: " + c467
slice(1	slice: " + c468
concat([9]	concat: " + c469
push(7	push: " + c470
pop(	pop: " + c471
sort(	sort: " + c472`,
        (n, a, b) => `function c${n + 465}(): string {
    const a: number[] = [...given];
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c473
join	join("-"	join: " + c474
indexOf	indexOf(1	indexOf: " + c475
slice	slice(1	slice: " + c476
concat	concat([9]	concat: " + c477
push	push(7	push: " + c478
pop	pop(	pop: " + c479
sort	sort(	sort: " + c480`,
        (n, a, b, c) => `function c${n + 473}(): string {
    const a: number[] = [...given];
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spread ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c481
join("-"	join: " + c482
indexOf(1	indexOf: " + c483
slice(1	slice: " + c484
concat([9]	concat: " + c485
push(7	push: " + c486
pop(	pop: " + c487
sort(	sort: " + c488`,
        (n, a, b) => `function c${n + 481}(): string {
    const a: number[] = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c489
join	join("-"	join: " + c490
indexOf	indexOf(1	indexOf: " + c491
slice	slice(1	slice: " + c492
concat	concat([9]	concat: " + c493
push	push(7	push: " + c494
pop	pop(	pop: " + c495
sort	sort(	sort: " + c496`,
        (n, a, b, c) => `function c${n + 489}(): string {
    const a: number[] = [...given, 5, ...given];
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain spreadMore ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c497
join("-"	join: " + c498
indexOf(1	indexOf: " + c499
slice(1	slice: " + c500
concat([9]	concat: " + c501
push(7	push: " + c502
pop(	pop: " + c503
sort(	sort: " + c504`,
        (n, a, b) => `function c${n + 497}(): string {
    const a: number[] = Array.from(given);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c505
join	join("-"	join: " + c506
indexOf	indexOf(1	indexOf: " + c507
slice	slice(1	slice: " + c508
concat	concat([9]	concat: " + c509
push	push(7	push: " + c510
pop	pop(	pop: " + c511
sort	sort(	sort: " + c512`,
        (n, a, b, c) => `function c${n + 505}(): string {
    const a: number[] = Array.from(given);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain from ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c513
join("-"	join: " + c514
indexOf(1	indexOf: " + c515
slice(1	slice: " + c516
concat([9]	concat: " + c517
push(7	push: " + c518
pop(	pop: " + c519
sort(	sort: " + c520`,
        (n, a, b) => `function c${n + 513}(): string {
    const a: number[] = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c521
join	join("-"	join: " + c522
indexOf	indexOf(1	indexOf: " + c523
slice	slice(1	slice: " + c524
concat	concat([9]	concat: " + c525
push	push(7	push: " + c526
pop	pop(	pop: " + c527
sort	sort(	sort: " + c528`,
        (n, a, b, c) => `function c${n + 521}(): string {
    const a: number[] = Array.of(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain of ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c529
join("-"	join: " + c530
indexOf(1	indexOf: " + c531
slice(1	slice: " + c532
concat([9]	concat: " + c533
push(7	push: " + c534
pop(	pop: " + c535
sort(	sort: " + c536`,
        (n, a, b) => `function c${n + 529}(): string {
    const a: number[] = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c537
join	join("-"	join: " + c538
indexOf	indexOf(1	indexOf: " + c539
slice	slice(1	slice: " + c540
concat	concat([9]	concat: " + c541
push	push(7	push: " + c542
pop	pop(	pop: " + c543
sort	sort(	sort: " + c544`,
        (n, a, b, c) => `function c${n + 537}(): string {
    const a: number[] = new Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain construct ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c545
join("-"	join: " + c546
indexOf(1	indexOf: " + c547
slice(1	slice: " + c548
concat([9]	concat: " + c549
push(7	push: " + c550
pop(	pop: " + c551
sort(	sort: " + c552`,
        (n, a, b) => `function c${n + 545}(): string {
    const a: number[] = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c553
join	join("-"	join: " + c554
indexOf	indexOf(1	indexOf: " + c555
slice	slice(1	slice: " + c556
concat	concat([9]	concat: " + c557
push	push(7	push: " + c558
pop	pop(	pop: " + c559
sort	sort(	sort: " + c560`,
        (n, a, b, c) => `function c${n + 553}(): string {
    const a: number[] = Array(3, 1, 2);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain call ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c561
join("-"	join: " + c562
indexOf(1	indexOf: " + c563
slice(1	slice: " + c564
concat([9]	concat: " + c565
push(7	push: " + c566
pop(	pop: " + c567
sort(	sort: " + c568`,
        (n, a, b) => `function c${n + 561}(): string {
    const a: number[] = given.map(x => x);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c569
join	join("-"	join: " + c570
indexOf	indexOf(1	indexOf: " + c571
slice	slice(1	slice: " + c572
concat	concat([9]	concat: " + c573
push	push(7	push: " + c574
pop	pop(	pop: " + c575
sort	sort(	sort: " + c576`,
        (n, a, b, c) => `function c${n + 569}(): string {
    const a: number[] = given.map(x => x);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain mapped ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c577
join("-"	join: " + c578
indexOf(1	indexOf: " + c579
slice(1	slice: " + c580
concat([9]	concat: " + c581
push(7	push: " + c582
pop(	pop: " + c583
sort(	sort: " + c584`,
        (n, a, b) => `function c${n + 577}(): string {
    const a: number[] = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c585
join	join("-"	join: " + c586
indexOf	indexOf(1	indexOf: " + c587
slice	slice(1	slice: " + c588
concat	concat([9]	concat: " + c589
push	push(7	push: " + c590
pop	pop(	pop: " + c591
sort	sort(	sort: " + c592`,
        (n, a, b, c) => `function c${n + 585}(): string {
    const a: number[] = given.filter(x => x > 0);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain filtered ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c593
join("-"	join: " + c594
indexOf(1	indexOf: " + c595
slice(1	slice: " + c596
concat([9]	concat: " + c597
push(7	push: " + c598
pop(	pop: " + c599
sort(	sort: " + c600`,
        (n, a, b) => `function c${n + 593}(): string {
    const a: number[] = given.slice();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c601
join	join("-"	join: " + c602
indexOf	indexOf(1	indexOf: " + c603
slice	slice(1	slice: " + c604
concat	concat([9]	concat: " + c605
push	push(7	push: " + c606
pop	pop(	pop: " + c607
sort	sort(	sort: " + c608`,
        (n, a, b, c) => `function c${n + 601}(): string {
    const a: number[] = given.slice();
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sliced ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c609
join("-"	join: " + c610
indexOf(1	indexOf: " + c611
slice(1	slice: " + c612
concat([9]	concat: " + c613
push(7	push: " + c614
pop(	pop: " + c615
sort(	sort: " + c616`,
        (n, a, b) => `function c${n + 609}(): string {
    const a: number[] = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c617
join	join("-"	join: " + c618
indexOf	indexOf(1	indexOf: " + c619
slice	slice(1	slice: " + c620
concat	concat([9]	concat: " + c621
push	push(7	push: " + c622
pop	pop(	pop: " + c623
sort	sort(	sort: " + c624`,
        (n, a, b, c) => `function c${n + 617}(): string {
    const a: number[] = Object.values({ a: 3, b: 1, c: 2 });
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain values ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c625
join("-"	join: " + c626
indexOf(1	indexOf: " + c627
slice(1	slice: " + c628
concat([9]	concat: " + c629
push(7	push: " + c630
pop(	pop: " + c631
sort(	sort: " + c632`,
        (n, a, b) => `function c${n + 625}(): string {
    const a: number[] = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c633
join	join("-"	join: " + c634
indexOf	indexOf(1	indexOf: " + c635
slice	slice(1	slice: " + c636
concat	concat([9]	concat: " + c637
push	push(7	push: " + c638
pop	pop(	pop: " + c639
sort	sort(	sort: " + c640`,
        (n, a, b, c) => `function c${n + 633}(): string {
    const a: number[] = given.toSorted((x, y) => y - x);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain toSorted ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c641
join("-"	join: " + c642
indexOf(1	indexOf: " + c643
slice(1	slice: " + c644
concat([9]	concat: " + c645
push(7	push: " + c646
pop(	pop: " + c647
sort(	sort: " + c648`,
        (n, a, b) => `function c${n + 641}(): string {
    const a: number[] = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c649
join	join("-"	join: " + c650
indexOf	indexOf(1	indexOf: " + c651
slice	slice(1	slice: " + c652
concat	concat([9]	concat: " + c653
push	push(7	push: " + c654
pop	pop(	pop: " + c655
sort	sort(	sort: " + c656`,
        (n, a, b, c) => `function c${n + 649}(): string {
    const a: number[] = [3, 1, 2].sort();
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain sorted ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c657
join("-"	join: " + c658
indexOf(1	indexOf: " + c659
slice(1	slice: " + c660
concat([9]	concat: " + c661
push(7	push: " + c662
pop(	pop: " + c663
sort(	sort: " + c664`,
        (n, a, b) => `function c${n + 657}(): string {
    const a: number[] = given.concat([4]);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c665
join	join("-"	join: " + c666
indexOf	indexOf(1	indexOf: " + c667
slice	slice(1	slice: " + c668
concat	concat([9]	concat: " + c669
push	push(7	push: " + c670
pop	pop(	pop: " + c671
sort	sort(	sort: " + c672`,
        (n, a, b, c) => `function c${n + 665}(): string {
    const a: number[] = given.concat([4]);
    let sum = 0; let r: unknown;
    (a as any).${a} = () => "its own";
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain concat ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c673
join("-"	join: " + c674
indexOf(1	indexOf: " + c675
slice(1	slice: " + c676
concat([9]	concat: " + c677
push(7	push: " + c678
pop(	pop: " + c679
sort(	sort: " + c680`,
        (n, a, b) => `function c${n + 673}(): string {
    const a: number[] = fresh();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c681
join	join("-"	join: " + c682
indexOf	indexOf(1	indexOf: " + c683
slice	slice(1	slice: " + c684
concat	concat([9]	concat: " + c685
push	push(7	push: " + c686
pop	pop(	pop: " + c687
sort	sort(	sort: " + c688`,
        (n, a, b, c) => `function c${n + 681}(): string {
    const a: number[] = fresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain fresh alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c689
join("-"	join: " + c690
indexOf(1	indexOf: " + c691
slice(1	slice: " + c692
concat([9]	concat: " + c693
push(7	push: " + c694
pop(	pop: " + c695
sort(	sort: " + c696`,
        (n, a, b) => `function c${n + 689}(): string {
    const a: number[] = freshLiteral();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c697
join	join("-"	join: " + c698
indexOf	indexOf(1	indexOf: " + c699
slice	slice(1	slice: " + c700
concat	concat([9]	concat: " + c701
push	push(7	push: " + c702
pop	pop(	pop: " + c703
sort	sort(	sort: " + c704`,
        (n, a, b, c) => `function c${n + 697}(): string {
    const a: number[] = freshLiteral();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshLiteral alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c705
join("-"	join: " + c706
indexOf(1	indexOf: " + c707
slice(1	slice: " + c708
concat([9]	concat: " + c709
push(7	push: " + c710
pop(	pop: " + c711
sort(	sort: " + c712`,
        (n, a, b) => `function c${n + 705}(): string {
    const a: number[] = freshSpread();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c713
join	join("-"	join: " + c714
indexOf	indexOf(1	indexOf: " + c715
slice	slice(1	slice: " + c716
concat	concat([9]	concat: " + c717
push	push(7	push: " + c718
pop	pop(	pop: " + c719
sort	sort(	sort: " + c720`,
        (n, a, b, c) => `function c${n + 713}(): string {
    const a: number[] = freshSpread();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshSpread alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c721
join("-"	join: " + c722
indexOf(1	indexOf: " + c723
slice(1	slice: " + c724
concat([9]	concat: " + c725
push(7	push: " + c726
pop(	pop: " + c727
sort(	sort: " + c728`,
        (n, a, b) => `function c${n + 721}(): string {
    const a: number[] = freshKeys();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c729
join	join("-"	join: " + c730
indexOf	indexOf(1	indexOf: " + c731
slice	slice(1	slice: " + c732
concat	concat([9]	concat: " + c733
push	push(7	push: " + c734
pop	pop(	pop: " + c735
sort	sort(	sort: " + c736`,
        (n, a, b, c) => `function c${n + 729}(): string {
    const a: number[] = freshKeys();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain freshKeys alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c737
join("-"	join: " + c738
indexOf(1	indexOf: " + c739
slice(1	slice: " + c740
concat([9]	concat: " + c741
push(7	push: " + c742
pop(	pop: " + c743
sort(	sort: " + c744`,
        (n, a, b) => `function c${n + 737}(): string {
    const a: number[] = throughFresh();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c745
join	join("-"	join: " + c746
indexOf	indexOf(1	indexOf: " + c747
slice	slice(1	slice: " + c748
concat	concat([9]	concat: " + c749
push	push(7	push: " + c750
pop	pop(	pop: " + c751
sort	sort(	sort: " + c752`,
        (n, a, b, c) => `function c${n + 745}(): string {
    const a: number[] = throughFresh();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain throughFresh alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c753
join("-"	join: " + c754
indexOf(1	indexOf: " + c755
slice(1	slice: " + c756
concat([9]	concat: " + c757
push(7	push: " + c758
pop(	pop: " + c759
sort(	sort: " + c760`,
        (n, a, b) => `function c${n + 753}(): string {
    const a: number[] = recursive(2);
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c761
join	join("-"	join: " + c762
indexOf	indexOf(1	indexOf: " + c763
slice	slice(1	slice: " + c764
concat	concat([9]	concat: " + c765
push	push(7	push: " + c766
pop	pop(	pop: " + c767
sort	sort(	sort: " + c768`,
        (n, a, b, c) => `function c${n + 761}(): string {
    const a: number[] = recursive(2);
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain recursive alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c769
join("-"	join: " + c770
indexOf(1	indexOf: " + c771
slice(1	slice: " + c772
concat([9]	concat: " + c773
push(7	push: " + c774
pop(	pop: " + c775
sort(	sort: " + c776`,
        (n, a, b) => `function c${n + 769}(): string {
    const a: number[] = kept();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c777
join	join("-"	join: " + c778
indexOf	indexOf(1	indexOf: " + c779
slice	slice(1	slice: " + c780
concat	concat([9]	concat: " + c781
push	push(7	push: " + c782
pop	pop(	pop: " + c783
sort	sort(	sort: " + c784`,
        (n, a, b, c) => `function c${n + 777}(): string {
    const a: number[] = kept();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain kept alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c785
join("-"	join: " + c786
indexOf(1	indexOf: " + c787
slice(1	slice: " + c788
concat([9]	concat: " + c789
push(7	push: " + c790
pop(	pop: " + c791
sort(	sort: " + c792`,
        (n, a, b) => `function c${n + 785}(): string {
    const a: number[] = keptOnOneRoad();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c793
join	join("-"	join: " + c794
indexOf	indexOf(1	indexOf: " + c795
slice	slice(1	slice: " + c796
concat	concat([9]	concat: " + c797
push	push(7	push: " + c798
pop	pop(	pop: " + c799
sort	sort(	sort: " + c800`,
        (n, a, b, c) => `function c${n + 793}(): string {
    const a: number[] = keptOnOneRoad();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptOnOneRoad alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c801
join("-"	join: " + c802
indexOf(1	indexOf: " + c803
slice(1	slice: " + c804
concat([9]	concat: " + c805
push(7	push: " + c806
pop(	pop: " + c807
sort(	sort: " + c808`,
        (n, a, b) => `function c${n + 801}(): string {
    const a: number[] = keptByClosure();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c809
join	join("-"	join: " + c810
indexOf	indexOf(1	indexOf: " + c811
slice	slice(1	slice: " + c812
concat	concat([9]	concat: " + c813
push	push(7	push: " + c814
pop	pop(	pop: " + c815
sort	sort(	sort: " + c816`,
        (n, a, b, c) => `function c${n + 809}(): string {
    const a: number[] = keptByClosure();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain keptByClosure alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c817
join("-"	join: " + c818
indexOf(1	indexOf: " + c819
slice(1	slice: " + c820
concat([9]	concat: " + c821
push(7	push: " + c822
pop(	pop: " + c823
sort(	sort: " + c824`,
        (n, a, b) => `function c${n + 817}(): string {
    const a: number[] = handedOn();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c825
join	join("-"	join: " + c826
indexOf	indexOf(1	indexOf: " + c827
slice	slice(1	slice: " + c828
concat	concat([9]	concat: " + c829
push	push(7	push: " + c830
pop	pop(	pop: " + c831
sort	sort(	sort: " + c832`,
        (n, a, b, c) => `function c${n + 825}(): string {
    const a: number[] = handedOn();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain handedOn alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c833
join("-"	join: " + c834
indexOf(1	indexOf: " + c835
slice(1	slice: " + c836
concat([9]	concat: " + c837
push(7	push: " + c838
pop(	pop: " + c839
sort(	sort: " + c840`,
        (n, a, b) => `function c${n + 833}(): string {
    const a: number[] = memo();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c841
join	join("-"	join: " + c842
indexOf	indexOf(1	indexOf: " + c843
slice	slice(1	slice: " + c844
concat	concat([9]	concat: " + c845
push	push(7	push: " + c846
pop	pop(	pop: " + c847
sort	sort(	sort: " + c848`,
        (n, a, b, c) => `function c${n + 841}(): string {
    const a: number[] = memo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain memo alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c849
join("-"	join: " + c850
indexOf(1	indexOf: " + c851
slice(1	slice: " + c852
concat([9]	concat: " + c853
push(7	push: " + c854
pop(	pop: " + c855
sort(	sort: " + c856`,
        (n, a, b) => `function c${n + 849}(): string {
    const a: number[] = oneOfTwo();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c857
join	join("-"	join: " + c858
indexOf	indexOf(1	indexOf: " + c859
slice	slice(1	slice: " + c860
concat	concat([9]	concat: " + c861
push	push(7	push: " + c862
pop	pop(	pop: " + c863
sort	sort(	sort: " + c864`,
        (n, a, b, c) => `function c${n + 857}(): string {
    const a: number[] = oneOfTwo();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain oneOfTwo alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c865
join("-"	join: " + c866
indexOf(1	indexOf: " + c867
slice(1	slice: " + c868
concat([9]	concat: " + c869
push(7	push: " + c870
pop(	pop: " + c871
sort(	sort: " + c872`,
        (n, a, b) => `function c${n + 865}(): string {
    const a: number[] = alteredInside();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c873
join	join("-"	join: " + c874
indexOf	indexOf(1	indexOf: " + c875
slice	slice(1	slice: " + c876
concat	concat([9]	concat: " + c877
push	push(7	push: " + c878
pop	pop(	pop: " + c879
sort	sort(	sort: " + c880`,
        (n, a, b, c) => `function c${n + 873}(): string {
    const a: number[] = alteredInside();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain alteredInside alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c881
join("-"	join: " + c882
indexOf(1	indexOf: " + c883
slice(1	slice: " + c884
concat([9]	concat: " + c885
push(7	push: " + c886
pop(	pop: " + c887
sort(	sort: " + c888`,
        (n, a, b) => `function c${n + 881}(): string {
    const a: number[] = anHeir();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir nothing ${b}());`,
      ],
      [
        `map	map((x: number) => x * 2	map: " + c889
join	join("-"	join: " + c890
indexOf	indexOf(1	indexOf: " + c891
slice	slice(1	slice: " + c892
concat	concat([9]	concat: " + c893
push	push(7	push: " + c894
pop	pop(	pop: " + c895
sort	sort(	sort: " + c896`,
        (n, a, b, c) => `function c${n + 889}(): string {
    const a: number[] = anHeir();
    let sum = 0; let r: unknown;
    alterWhatIsHeld("${a}");
    try { r = a.${b}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain anHeir alterHeld ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c897
join("-"	join: " + c898
indexOf(1	indexOf: " + c899
slice(1	slice: " + c900
concat([9]	concat: " + c901
push(7	push: " + c902
pop(	pop: " + c903
sort(	sort: " + c904`,
        (n, a, b) => `function c${n + 897}(): string {
    const a: number[] = frozenInside();
    let sum = 0; let r: unknown;
    try { r = a.${a}); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum + " " + show(a);
}
lines.push("plain frozenInside nothing ${b}());`,
      ],
      [
        `map((x: number) => x * 2	(a as any).map = () => "its own"	ownMethod map: " + c905	join("-"	(a as any).join = () => "its own"	ownMethod join: " + c906
indexOf(1	(a as any).indexOf = () => "its own"	ownMethod indexOf: " + c907	slice(1	(a as any).slice = () => "its own"	ownMethod slice: " + c908
concat([9]	(a as any).concat = () => "its own"	ownMethod concat: " + c909	push(7	(a as any).push = () => "its own"	ownMethod push: " + c910
pop(	(a as any).pop = () => "its own"	ownMethod pop: " + c911	sort(	(a as any).sort = () => "its own"	ownMethod sort: " + c912
map((x: number) => x * 2	meddlers[yes ? 0 : 2](a, "map")	elsewhere map: " + c913	join("-"	meddlers[yes ? 0 : 2](a, "join")	elsewhere join: " + c914
indexOf(1	meddlers[yes ? 0 : 2](a, "indexOf")	elsewhere indexOf: " + c915	slice(1	meddlers[yes ? 0 : 2](a, "slice")	elsewhere slice: " + c916
concat([9]	meddlers[yes ? 0 : 2](a, "concat")	elsewhere concat: " + c917	push(7	meddlers[yes ? 0 : 2](a, "push")	elsewhere push: " + c918
pop(	meddlers[yes ? 0 : 2](a, "pop")	elsewhere pop: " + c919	sort(	meddlers[yes ? 0 : 2](a, "sort")	elsewhere sort: " + c920
map((x: number) => x * 2	Object.setPrototypeOf(a, otherPrototype("map"))	prototype map: " + c921	join("-"	Object.setPrototypeOf(a, otherPrototype("join"))	prototype join: " + c922
indexOf(1	Object.setPrototypeOf(a, otherPrototype("indexOf"))	prototype indexOf: " + c923	slice(1	Object.setPrototypeOf(a, otherPrototype("slice"))	prototype slice: " + c924
concat([9]	Object.setPrototypeOf(a, otherPrototype("concat"))	prototype concat: " + c925	push(7	Object.setPrototypeOf(a, otherPrototype("push"))	prototype push: " + c926
pop(	Object.setPrototypeOf(a, otherPrototype("pop"))	prototype pop: " + c927	sort(	Object.setPrototypeOf(a, otherPrototype("sort"))	prototype sort: " + c928
map((x: number) => x * 2	Object.freeze(a)	frozen map: " + c929	join("-"	Object.freeze(a)	frozen join: " + c930
indexOf(1	Object.freeze(a)	frozen indexOf: " + c931	slice(1	Object.freeze(a)	frozen slice: " + c932
concat([9]	Object.freeze(a)	frozen concat: " + c933	push(7	Object.freeze(a)	frozen push: " + c934
pop(	Object.freeze(a)	frozen pop: " + c935	sort(	Object.freeze(a)	frozen sort: " + c936
map((x: number) => x * 2	(a as any).extra = 1	harmlessName map: " + c937	join("-"	(a as any).extra = 1	harmlessName join: " + c938
indexOf(1	(a as any).extra = 1	harmlessName indexOf: " + c939	slice(1	(a as any).extra = 1	harmlessName slice: " + c940
concat([9]	(a as any).extra = 1	harmlessName concat: " + c941	push(7	(a as any).extra = 1	harmlessName push: " + c942
pop(	(a as any).extra = 1	harmlessName pop: " + c943	sort(	(a as any).extra = 1	harmlessName sort: " + c944
map((x: number) => x * 2	holder.it = a; alterWhatIsHeld("map")	held map: " + c945	join("-"	holder.it = a; alterWhatIsHeld("join")	held join: " + c946
indexOf(1	holder.it = a; alterWhatIsHeld("indexOf")	held indexOf: " + c947	slice(1	holder.it = a; alterWhatIsHeld("slice")	held slice: " + c948
concat([9]	holder.it = a; alterWhatIsHeld("concat")	held concat: " + c949	push(7	holder.it = a; alterWhatIsHeld("push")	held push: " + c950
pop(	holder.it = a; alterWhatIsHeld("pop")	held pop: " + c951	sort(	holder.it = a; alterWhatIsHeld("sort")	held sort: " + c952`,
        (n, a, b, c, d, e, f) => `function c${2 * n + 905}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { ${b}; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ${c}());
function c${2 * n + 906}(): string {
    const a: number[] = [3, 1, 2];
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        let r: unknown;
        try { r = a.${d}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        if (i === 1) { ${e}; }
    }
    return text + " " + sum + " " + show(a);
}
lines.push("loop literal ${f}());`,
      ],
      [
        `map((x: number) => x * 2	map	map: " + c953
join("-"	join	join: " + c954
indexOf(1	indexOf	indexOf: " + c955
slice(1	slice	slice: " + c956
concat([9]	concat	concat: " + c957
push(7	push	push: " + c958
pop(	pop	pop: " + c959
sort(	sort	sort: " + c960`,
        (n, a, b, c) => `function c${n + 953}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: number[] = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).${b} = () => "its own";
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ownMethod ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map	map: " + c961
join("-"	join	join: " + c962
indexOf(1	indexOf	indexOf: " + c963
slice(1	slice	slice: " + c964
concat([9]	concat	concat: " + c965
push(7	push	push: " + c966
pop(	pop	pop: " + c967
sort(	sort	sort: " + c968`,
        (n, a, b, c) => `function c${n + 961}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: number[] = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        meddlers[yes ? 0 : 2](a, "${b}");
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal elsewhere ${c}());`,
      ],
      [
        `map((x: number) => x * 2	setPrototypeOf(a, otherPrototype("map")	prototype map: " + c969
join("-"	setPrototypeOf(a, otherPrototype("join")	prototype join: " + c970
indexOf(1	setPrototypeOf(a, otherPrototype("indexOf")	prototype indexOf: " + c971
slice(1	setPrototypeOf(a, otherPrototype("slice")	prototype slice: " + c972
concat([9]	setPrototypeOf(a, otherPrototype("concat")	prototype concat: " + c973
push(7	setPrototypeOf(a, otherPrototype("push")	prototype push: " + c974
pop(	setPrototypeOf(a, otherPrototype("pop")	prototype pop: " + c975
sort(	setPrototypeOf(a, otherPrototype("sort")	prototype sort: " + c976
map((x: number) => x * 2	freeze(a	frozen map: " + c977
join("-"	freeze(a	frozen join: " + c978
indexOf(1	freeze(a	frozen indexOf: " + c979
slice(1	freeze(a	frozen slice: " + c980
concat([9]	freeze(a	frozen concat: " + c981
push(7	freeze(a	frozen push: " + c982
pop(	freeze(a	frozen pop: " + c983
sort(	freeze(a	frozen sort: " + c984`,
        (n, a, b, c) => `function c${n + 969}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: number[] = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        Object.${b});
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal ${c}());`,
      ],
      [
        `map((x: number) => x * 2	map: " + c985
join("-"	join: " + c986
indexOf(1	indexOf: " + c987
slice(1	slice: " + c988
concat([9]	concat: " + c989
push(7	push: " + c990
pop(	pop: " + c991
sort(	sort: " + c992`,
        (n, a, b) => `function c${n + 985}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: number[] = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        (a as any).extra = 1;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal harmlessName ${b}());`,
      ],
      [
        `map((x: number) => x * 2	map	map: " + c993
join("-"	join	join: " + c994
indexOf(1	indexOf	indexOf: " + c995
slice(1	slice	slice: " + c996
concat([9]	concat	concat: " + c997
push(7	push	push: " + c998
pop(	pop	pop: " + c999
sort(	sort	sort: " + c1000`,
        (n, a, b, c) => `function c${n + 993}(): string {
    let sum = 0; let text = "";
    for (let i = 0; i < 3; i++) {
        const a: number[] = [3, 1, 2];
        let r: unknown;
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
        holder.it = a; alterWhatIsHeld("${b}");
        try { r = a.${a}); } catch (e) { r = thrown(e); }
        text += show(r) + ";";
    }
    return text + " " + sum;
}
lines.push("bornInLoop literal held ${c}());`,
      ],
      `
function restOf(...a: number[]): string { let r: unknown; try { r = a.map((x: number) => x + 1); } catch (e) { r = thrown(e); } return show(r); }
function restAltered(...a: number[]): string { (a as any).map = () => "its own"; let r: unknown; try { r = a.map((x: number) => x + 1); } catch (e) { r = thrown(e); } return show(r); }
lines.push("rest: " + restOf(1, 2, 3) + " " + restAltered(1, 2, 3));
async function acrossAwait(): Promise<string> { const a: number[] = [3, 1, 2]; await null; const first = show(a.map((x: number) => x * 2)); holder.it = a; await null; alterWhatIsHeld("map"); await null; let r: unknown; try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); } return first + " " + show(r); }
function* acrossYield(): Generator<string> { const a: number[] = [3, 1, 2]; yield show(a.map((x: number) => x * 2)); holder.it = a; yield "held"; let r: unknown; try { r = a.map((x: number) => x * 2); } catch (e) { r = thrown(e); } yield show(r); }
const steps = acrossYield(); lines.push("yield: " + steps.next().value + " " + steps.next().value); alterWhatIsHeld("map"); lines.push("yield: " + steps.next().value);
`,
      [
        `s.has(1)	has: " + c1001
s.add(3).size	add: " + c1002
s.delete(1)	delete: " + c1003
s.size	size: " + c1004
s.forEach((x: number) => { sum += x; })	forEach: " + c1005
[...s.values()]	values: " + c1006
s.clear()	clear: " + c1007`,
        (n, a, b) => `function c${n + 1001}(): string {
    const s = new Set([1, 2]);
    let sum = 0; let r: unknown;
    
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set nothing ${b}());`,
      ],
      [
        `has	s.has(1)	has: " + c1008
add	s.add(3).size	add: " + c1009
delete	s.delete(1)	delete: " + c1010
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1011
values	[...s.values()]	values: " + c1012
clear	s.clear()	clear: " + c1013`,
        (n, a, b, c) => `function c${n + 1008}(): string {
    const s = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).${a} = () => "its own";
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set ownMethod ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1014
add	s.add(3).size	add: " + c1015
delete	s.delete(1)	delete: " + c1016
size	s.size	size: " + c1017
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1018
values	[...s.values()]	values: " + c1019
clear	s.clear()	clear: " + c1020`,
        (n, a, b, c) => `function c${n + 1014}(): string {
    const s = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { ${a}: function () { return "of another prototype"; } });
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set prototype ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1021
add	s.add(3).size	add: " + c1022
delete	s.delete(1)	delete: " + c1023
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1024
values	[...s.values()]	values: " + c1025
clear	s.clear()	clear: " + c1026`,
        (n, a, b, c) => `function c${n + 1021}(): string {
    const s = new Set([1, 2]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "${a}");
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set elsewhere ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1027
add	s.add(3).size	add: " + c1028
delete	s.delete(1)	delete: " + c1029
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1030
values	[...s.values()]	values: " + c1031
clear	s.clear()	clear: " + c1032`,
        (n, a, b, c) => `function c${n + 1027}(): string {
    const s = new Set([1, 2]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("${a}");
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set held ${c}());`,
      ],
      [
        `s.has(1)	has: " + c1033
s.add(3).size	add: " + c1034
s.delete(1)	delete: " + c1035
s.size	size: " + c1036
s.forEach((x: number) => { sum += x; })	forEach: " + c1037
[...s.values()]	values: " + c1038
s.clear()	clear: " + c1039`,
        (n, a, b) => `function c${n + 1033}(): string {
    const s = new Set([1, 2]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set frozen ${b}());`,
      ],
      [
        `s.has(1)	has: " + c1040
s.add(3).size	add: " + c1041
s.delete(1)	delete: " + c1042
s.size	size: " + c1043
s.forEach((x: number) => { sum += x; })	forEach: " + c1044
[...s.values()]	values: " + c1045
s.clear()	clear: " + c1046`,
        (n, a, b) => `function c${n + 1040}(): string {
    const s = new Set([1, 2]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Set harmlessName ${b}());`,
      ],
      [
        `s.has(1)	has: " + c1047
s.get(1)	get: " + c1048
s.set(3, 4).size	set: " + c1049
s.delete(1)	delete: " + c1050
s.size	size: " + c1051
s.forEach((x: number) => { sum += x; })	forEach: " + c1052
[...s.keys()]	keys: " + c1053
s.clear()	clear: " + c1054`,
        (n, a, b) => `function c${n + 1047}(): string {
    const s = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map nothing ${b}());`,
      ],
      [
        `has	s.has(1)	has: " + c1055
get	s.get(1)	get: " + c1056
set	s.set(3, 4).size	set: " + c1057
delete	s.delete(1)	delete: " + c1058
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1059
keys	[...s.keys()]	keys: " + c1060
clear	s.clear()	clear: " + c1061`,
        (n, a, b, c) => `function c${n + 1055}(): string {
    const s = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).${a} = () => "its own";
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map ownMethod ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1062
get	s.get(1)	get: " + c1063
set	s.set(3, 4).size	set: " + c1064
delete	s.delete(1)	delete: " + c1065
size	s.size	size: " + c1066
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1067
keys	[...s.keys()]	keys: " + c1068
clear	s.clear()	clear: " + c1069`,
        (n, a, b, c) => `function c${n + 1062}(): string {
    const s = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { ${a}: function () { return "of another prototype"; } });
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map prototype ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1070
get	s.get(1)	get: " + c1071
set	s.set(3, 4).size	set: " + c1072
delete	s.delete(1)	delete: " + c1073
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1074
keys	[...s.keys()]	keys: " + c1075
clear	s.clear()	clear: " + c1076`,
        (n, a, b, c) => `function c${n + 1070}(): string {
    const s = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "${a}");
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map elsewhere ${c}());`,
      ],
      [
        `has	s.has(1)	has: " + c1077
get	s.get(1)	get: " + c1078
set	s.set(3, 4).size	set: " + c1079
delete	s.delete(1)	delete: " + c1080
forEach	s.forEach((x: number) => { sum += x; })	forEach: " + c1081
keys	[...s.keys()]	keys: " + c1082
clear	s.clear()	clear: " + c1083`,
        (n, a, b, c) => `function c${n + 1077}(): string {
    const s = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("${a}");
    try { r = ${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map held ${c}());`,
      ],
      [
        `s.has(1)	has: " + c1084
s.get(1)	get: " + c1085
s.set(3, 4).size	set: " + c1086
s.delete(1)	delete: " + c1087
s.size	size: " + c1088
s.forEach((x: number) => { sum += x; })	forEach: " + c1089
[...s.keys()]	keys: " + c1090
s.clear()	clear: " + c1091`,
        (n, a, b) => `function c${n + 1084}(): string {
    const s = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map frozen ${b}());`,
      ],
      [
        `s.has(1)	has: " + c1092
s.get(1)	get: " + c1093
s.set(3, 4).size	set: " + c1094
s.delete(1)	delete: " + c1095
s.size	size: " + c1096
s.forEach((x: number) => { sum += x; })	forEach: " + c1097
[...s.keys()]	keys: " + c1098
s.clear()	clear: " + c1099`,
        (n, a, b) => `function c${n + 1092}(): string {
    const s = new Map([[1, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Map harmlessName ${b}());`,
      ],
      [
        `has(holder)	has: " + c1100
get(holder)	get: " + c1101
set(given, 4) === s	set: " + c1102
delete(holder)	delete: " + c1103`,
        (n, a, b) => `function c${n + 1100}(): string {
    const s = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    
    try { r = s.${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap nothing ${b}());`,
      ],
      [
        `has	has(holder)	has: " + c1104
get	get(holder)	get: " + c1105
set	set(given, 4) === s	set: " + c1106
delete	delete(holder)	delete: " + c1107`,
        (n, a, b, c) => `function c${n + 1104}(): string {
    const s = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).${a} = () => "its own";
    try { r = s.${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap ownMethod ${c}());`,
      ],
      [
        `has	has(holder)	has: " + c1108
get	get(holder)	get: " + c1109
set	set(given, 4) === s	set: " + c1110
delete	delete(holder)	delete: " + c1111`,
        (n, a, b, c) => `function c${n + 1108}(): string {
    const s = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { ${a}: function () { return "of another prototype"; } });
    try { r = s.${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap prototype ${c}());`,
      ],
      [
        `has	has(holder)	has: " + c1112
get	get(holder)	get: " + c1113
set	set(given, 4) === s	set: " + c1114
delete	delete(holder)	delete: " + c1115`,
        (n, a, b, c) => `function c${n + 1112}(): string {
    const s = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    meddlers[yes ? 0 : 2](s, "${a}");
    try { r = s.${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap elsewhere ${c}());`,
      ],
      [
        `has	has(holder)	has: " + c1116
get	get(holder)	get: " + c1117
set	set(given, 4) === s	set: " + c1118
delete	delete(holder)	delete: " + c1119`,
        (n, a, b, c) => `function c${n + 1116}(): string {
    const s = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    holder.it = s; alterWhatIsHeld("${a}");
    try { r = s.${b}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap held ${c}());`,
      ],
      [
        `has(holder)	has: " + c1120
get(holder)	get: " + c1121
set(given, 4) === s	set: " + c1122
delete(holder)	delete: " + c1123`,
        (n, a, b) => `function c${n + 1120}(): string {
    const s = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap frozen ${b}());`,
      ],
      [
        `has(holder)	has: " + c1124
get(holder)	get: " + c1125
set(given, 4) === s	set: " + c1126
delete(holder)	delete: " + c1127`,
        (n, a, b) => `function c${n + 1124}(): string {
    const s = new WeakMap<object, number>([[holder, 2]]);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.${a}; } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("WeakMap harmlessName ${b}());`,
      ],
      [
        `getTime	getTime: " + c1128
getUTCFullYear	getUTCFullYear: " + c1129
toISOString	toISOString: " + c1130
valueOf	valueOf: " + c1131`,
        (n, a, b) => `function c${n + 1128}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date nothing ${b}());`,
      ],
      [
        `getTime	getTime: " + c1132
getUTCFullYear	getUTCFullYear: " + c1133
toISOString	toISOString: " + c1134
valueOf	valueOf: " + c1135`,
        (n, a, b) => `function c${n + 1132}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).${a} = () => "its own";
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ownMethod ${b}());`,
      ],
      [
        `getTime	getTime: " + c1136
getUTCFullYear	getUTCFullYear: " + c1137
toISOString	toISOString: " + c1138
valueOf	valueOf: " + c1139`,
        (n, a, b) => `function c${n + 1136}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { ${a}: function () { return "of another prototype"; } });
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date prototype ${b}());`,
      ],
      [
        `meddlers[yes ? 0 : 2](s, 	elsewhere getTime: " + c1140	elsewhere getUTCFullYear: " + c1141	elsewhere toISOString: " + c1142	elsewhere valueOf: " + c1143
holder.it = s; alterWhatIsHeld(	held getTime: " + c1144	held getUTCFullYear: " + c1145	held toISOString: " + c1146	held valueOf: " + c1147`,
        (n, a, b, c, d, e) => `function c${4 * n + 1140}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    ${a}"getTime");
    try { r = s.getTime(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ${b}());
function c${4 * n + 1141}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    ${a}"getUTCFullYear");
    try { r = s.getUTCFullYear(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ${c}());
function c${4 * n + 1142}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    ${a}"toISOString");
    try { r = s.toISOString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ${d}());
function c${4 * n + 1143}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    ${a}"valueOf");
    try { r = s.valueOf(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date ${e}());`,
      ],
      [
        `getTime	getTime: " + c1148
getUTCFullYear	getUTCFullYear: " + c1149
toISOString	toISOString: " + c1150
valueOf	valueOf: " + c1151`,
        (n, a, b) => `function c${n + 1148}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date frozen ${b}());`,
      ],
      [
        `getTime	getTime: " + c1152
getUTCFullYear	getUTCFullYear: " + c1153
toISOString	toISOString: " + c1154
valueOf	valueOf: " + c1155`,
        (n, a, b) => `function c${n + 1152}(): string {
    const s = new Date(86400000 * 365);
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.${a}(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("Date harmlessName ${b}());`,
      ],
      `function c1156(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing test: " + c1156());
function c1157(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing exec: " + c1157());
function c1158(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp nothing toString: " + c1158());
function c1159(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).test = () => "its own";
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod test: " + c1159());
function c1160(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).exec = () => "its own";
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod exec: " + c1160());
function c1161(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).toString = () => "its own";
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ownMethod toString: " + c1161());
function c1162(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { test: function () { return "of another prototype"; } });
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp prototype test: " + c1162());
function c1163(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { exec: function () { return "of another prototype"; } });
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp prototype exec: " + c1163());
function c1164(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    Object.setPrototypeOf(s, { toString: function () { return "of another prototype"; } });`,
      [
        `prototype toString: " + c1164	meddlers[yes ? 0 : 2](s, 	elsewhere test: " + c1165	elsewhere exec: " + c1166
elsewhere toString: " + c1167	holder.it = s; alterWhatIsHeld(	held test: " + c1168	held exec: " + c1169`,
        (n, a, b, c, d) => `    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ${a}());
function c${3 * n + 1165}(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    ${b}"test");
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ${c}());
function c${3 * n + 1166}(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    ${b}"exec");
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp ${d}());
function c${3 * n + 1167}(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    ${b}"toString");`,
      ],
      `    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp held toString: " + c1170());
function c1171(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen test: " + c1171());
function c1172(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen exec: " + c1172());
function c1173(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    Object.freeze(s);
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp frozen toString: " + c1173());
function c1174(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.test("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName test: " + c1174());
function c1175(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s["exec"]("abbc"); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName exec: " + c1175());
function c1176(): string {
    const s = /b+/g;
    let sum = 0; let r: unknown;
    (s as any).extra = 1;
    try { r = s.toString(); } catch (e) { r = thrown(e); }
    return show(r) + " " + sum;
}
lines.push("RegExp harmlessName toString: " + c1176());
acrossAwait().then(text => { lines.push("await: " + text); console.log(lines.join("\\n")); });
`,
    ),
    "named-properties-under-mutators-untyped.ts": text(
      `
function show(v: unknown): string {
    if (Array.isArray(v)) {
        const parts: string[] = [];
        for (let i = 0; i < v.length && i < 12; i++) parts.push(i in v ? show(v[i]) : "hole");
        const own = Object.getOwnPropertyNames(v).filter(k => k !== "length" && !/^\\d+$/.test(k));
        return "[" + parts.join(",") + (v.length > 12 ? ",.. " + v.length + " .." + show(v[v.length - 1]) : "") + "]" + (own.length ? "{" + own.map(k => k + "=" + show((v as any)[k])).join(",") + "}" : "");
    }
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "object") return "{" + Object.keys(v as object).join(",") + "}";
    return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function thrown(e: unknown): string { return "throws " + (e instanceof Error ? e.constructor.name : show(e)); }
const lines: string[] = [];
let kept: unknown[] = [];
function churn(): void { for (let i = 0; i < 200; i++) kept[i % 7] = [i, { i }, "s" + i]; }

const holders: Array<(x: any) => any> = [x => x, x => x];
function holder(x: any): any { return holders[Date.now() > 0 ? 0 : 1](x); }`,
      [
        `.push(7.5)	push double: " + c1	.push("t")	push text: " + c2
.push(undefined)	push undefined: " + c3	.push(7.5, 7.5)	pushTwo double: " + c4
.push("t", "t")	pushTwo text: " + c5	.push(undefined, undefined)	pushTwo undefined: " + c6
.unshift(7.5)	unshift double: " + c7	.unshift("t")	unshift text: " + c8
.unshift(undefined)	unshift undefined: " + c9	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c10
.splice(1, 0, "t", "t")	spliceIn text: " + c11	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c12
.splice(0, 1, 7.5)	spliceOver double: " + c13	.splice(0, 1, "t")	spliceOver text: " + c14
.splice(0, 1, undefined)	spliceOver undefined: " + c15	.fill(7.5)	fill double: " + c16
.fill("t")	fill text: " + c17	.fill(undefined)	fill undefined: " + c18
.fill(7.5, 1, 2)	fillPart double: " + c19	.fill("t", 1, 2)	fillPart text: " + c20
.fill(undefined, 1, 2)	fillPart undefined: " + c21	[1] = 7.5	store double: " + c22
[1] = "t"	store text: " + c23	[1] = undefined	store undefined: " + c24
[a.length] = 7.5	storeAtEnd double: " + c25	[a.length] = "t"	storeAtEnd text: " + c26
[a.length] = undefined	storeAtEnd undefined: " + c27	.with(0, 7.5)	with double: " + c28
.with(0, "t")	with text: " + c29	.with(0, undefined)	with undefined: " + c30
.concat([7.5])	concat double: " + c31	.concat(["t"])	concat text: " + c32
.concat([undefined])	concat undefined: " + c33	.toSpliced(0, 0, 7.5)	toSpliced double: " + c34
.toSpliced(0, 0, "t")	toSpliced text: " + c35	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c36`,
        (n, a, b, c, d) => `function c${2 * n + 1}(): string {
    const given: any = [1, 2, 3];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one ${b}());
function c${2 * n + 2}(): string {
    const given: any = [1, 2, 3];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c37
unshift(7.5	unshiftMany double: " + c38
push("t"	pushMany text: " + c39
unshift("t"	unshiftMany text: " + c40
push(undefined	pushMany undefined: " + c41
unshift(undefined	unshiftMany undefined: " + c42`,
        (n, a, b) => `function c${n + 37}(): string {
    const given: any = [1, 2, 3];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c43
a.shift()	shift: " + c44
a.reverse()	reverse: " + c45
a.sort()	sort: " + c46
a.copyWithin(0, 1)	copyWithin: " + c47
a.splice(0, 2)	spliceOut: " + c48
a.length = 0	lengthZero: " + c49
a.slice(1)	slice: " + c50
a.map((x: unknown) => x)	map: " + c51
a.filter(() => true)	filter: " + c52
a.flat()	flat: " + c53
a.join()	join: " + c54
a.includes(3)	includes: " + c55
a.indexOf(3)	indexOf: " + c56
a.at(0)	at: " + c57
[...a]	spread: " + c58
[...a.entries()]	entries: " + c59`,
        (n, a, b) => `function c${n + 43}(): string {
    const given: any = [1, 2, 3];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c60	.push("t")	push text: " + c61
.push(undefined)	push undefined: " + c62	.push(7.5, 7.5)	pushTwo double: " + c63
.push("t", "t")	pushTwo text: " + c64	.push(undefined, undefined)	pushTwo undefined: " + c65
.unshift(7.5)	unshift double: " + c66	.unshift("t")	unshift text: " + c67
.unshift(undefined)	unshift undefined: " + c68	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c69
.splice(1, 0, "t", "t")	spliceIn text: " + c70	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c71
.splice(0, 1, 7.5)	spliceOver double: " + c72	.splice(0, 1, "t")	spliceOver text: " + c73
.splice(0, 1, undefined)	spliceOver undefined: " + c74	.fill(7.5)	fill double: " + c75
.fill("t")	fill text: " + c76	.fill(undefined)	fill undefined: " + c77
.fill(7.5, 1, 2)	fillPart double: " + c78	.fill("t", 1, 2)	fillPart text: " + c79
.fill(undefined, 1, 2)	fillPart undefined: " + c80	[1] = 7.5	store double: " + c81
[1] = "t"	store text: " + c82	[1] = undefined	store undefined: " + c83
[a.length] = 7.5	storeAtEnd double: " + c84	[a.length] = "t"	storeAtEnd text: " + c85
[a.length] = undefined	storeAtEnd undefined: " + c86	.with(0, 7.5)	with double: " + c87
.with(0, "t")	with text: " + c88	.with(0, undefined)	with undefined: " + c89
.concat([7.5])	concat double: " + c90	.concat(["t"])	concat text: " + c91
.concat([undefined])	concat undefined: " + c92	.toSpliced(0, 0, 7.5)	toSpliced double: " + c93
.toSpliced(0, 0, "t")	toSpliced text: " + c94	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c95`,
        (n, a, b, c, d) => `function c${2 * n + 60}(): string {
    const given: any = [1, 2, 3];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve ${b}());
function c${2 * n + 61}(): string {
    const given: any = [1, 2, 3];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c96
unshift(7.5	unshiftMany double: " + c97
push("t"	pushMany text: " + c98
unshift("t"	unshiftMany text: " + c99
push(undefined	pushMany undefined: " + c100
unshift(undefined	unshiftMany undefined: " + c101`,
        (n, a, b) => `function c${n + 96}(): string {
    const given: any = [1, 2, 3];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c102
a.shift()	shift: " + c103
a.reverse()	reverse: " + c104
a.sort()	sort: " + c105
a.copyWithin(0, 1)	copyWithin: " + c106
a.splice(0, 2)	spliceOut: " + c107
a.length = 0	lengthZero: " + c108
a.slice(1)	slice: " + c109
a.map((x: unknown) => x)	map: " + c110
a.filter(() => true)	filter: " + c111
a.flat()	flat: " + c112
a.join()	join: " + c113
a.includes(3)	includes: " + c114
a.indexOf(3)	indexOf: " + c115
a.at(0)	at: " + c116
[...a]	spread: " + c117
[...a.entries()]	entries: " + c118`,
        (n, a, b) => `function c${n + 102}(): string {
    const given: any = [1, 2, 3];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c119	.push("t")	push text: " + c120
.push(undefined)	push undefined: " + c121	.push(7.5, 7.5)	pushTwo double: " + c122
.push("t", "t")	pushTwo text: " + c123	.push(undefined, undefined)	pushTwo undefined: " + c124
.unshift(7.5)	unshift double: " + c125	.unshift("t")	unshift text: " + c126
.unshift(undefined)	unshift undefined: " + c127	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c128
.splice(1, 0, "t", "t")	spliceIn text: " + c129	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c130
.splice(0, 1, 7.5)	spliceOver double: " + c131	.splice(0, 1, "t")	spliceOver text: " + c132
.splice(0, 1, undefined)	spliceOver undefined: " + c133	.fill(7.5)	fill double: " + c134
.fill("t")	fill text: " + c135	.fill(undefined)	fill undefined: " + c136
.fill(7.5, 1, 2)	fillPart double: " + c137	.fill("t", 1, 2)	fillPart text: " + c138
.fill(undefined, 1, 2)	fillPart undefined: " + c139	[1] = 7.5	store double: " + c140
[1] = "t"	store text: " + c141	[1] = undefined	store undefined: " + c142
[a.length] = 7.5	storeAtEnd double: " + c143	[a.length] = "t"	storeAtEnd text: " + c144
[a.length] = undefined	storeAtEnd undefined: " + c145	.with(0, 7.5)	with double: " + c146
.with(0, "t")	with text: " + c147	.with(0, undefined)	with undefined: " + c148
.concat([7.5])	concat double: " + c149	.concat(["t"])	concat text: " + c150
.concat([undefined])	concat undefined: " + c151	.toSpliced(0, 0, 7.5)	toSpliced double: " + c152
.toSpliced(0, 0, "t")	toSpliced text: " + c153	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c154`,
        (n, a, b, c, d) => `function c${2 * n + 119}(): string {
    const given: any = [1.5, 2.5, 3.5];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one ${b}());
function c${2 * n + 120}(): string {
    const given: any = [1.5, 2.5, 3.5];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c155
unshift(7.5	unshiftMany double: " + c156
push("t"	pushMany text: " + c157
unshift("t"	unshiftMany text: " + c158
push(undefined	pushMany undefined: " + c159
unshift(undefined	unshiftMany undefined: " + c160`,
        (n, a, b) => `function c${n + 155}(): string {
    const given: any = [1.5, 2.5, 3.5];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c161
a.shift()	shift: " + c162
a.reverse()	reverse: " + c163
a.sort()	sort: " + c164
a.copyWithin(0, 1)	copyWithin: " + c165
a.splice(0, 2)	spliceOut: " + c166
a.length = 0	lengthZero: " + c167
a.slice(1)	slice: " + c168
a.map((x: unknown) => x)	map: " + c169
a.filter(() => true)	filter: " + c170
a.flat()	flat: " + c171
a.join()	join: " + c172
a.includes(3)	includes: " + c173
a.indexOf(3)	indexOf: " + c174
a.at(0)	at: " + c175
[...a]	spread: " + c176
[...a.entries()]	entries: " + c177`,
        (n, a, b) => `function c${n + 161}(): string {
    const given: any = [1.5, 2.5, 3.5];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c178	.push("t")	push text: " + c179
.push(undefined)	push undefined: " + c180	.push(7.5, 7.5)	pushTwo double: " + c181
.push("t", "t")	pushTwo text: " + c182	.push(undefined, undefined)	pushTwo undefined: " + c183
.unshift(7.5)	unshift double: " + c184	.unshift("t")	unshift text: " + c185
.unshift(undefined)	unshift undefined: " + c186	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c187
.splice(1, 0, "t", "t")	spliceIn text: " + c188	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c189
.splice(0, 1, 7.5)	spliceOver double: " + c190	.splice(0, 1, "t")	spliceOver text: " + c191
.splice(0, 1, undefined)	spliceOver undefined: " + c192	.fill(7.5)	fill double: " + c193
.fill("t")	fill text: " + c194	.fill(undefined)	fill undefined: " + c195
.fill(7.5, 1, 2)	fillPart double: " + c196	.fill("t", 1, 2)	fillPart text: " + c197
.fill(undefined, 1, 2)	fillPart undefined: " + c198	[1] = 7.5	store double: " + c199
[1] = "t"	store text: " + c200	[1] = undefined	store undefined: " + c201
[a.length] = 7.5	storeAtEnd double: " + c202	[a.length] = "t"	storeAtEnd text: " + c203
[a.length] = undefined	storeAtEnd undefined: " + c204	.with(0, 7.5)	with double: " + c205
.with(0, "t")	with text: " + c206	.with(0, undefined)	with undefined: " + c207
.concat([7.5])	concat double: " + c208	.concat(["t"])	concat text: " + c209
.concat([undefined])	concat undefined: " + c210	.toSpliced(0, 0, 7.5)	toSpliced double: " + c211
.toSpliced(0, 0, "t")	toSpliced text: " + c212	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c213`,
        (n, a, b, c, d) => `function c${2 * n + 178}(): string {
    const given: any = [1.5, 2.5, 3.5];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve ${b}());
function c${2 * n + 179}(): string {
    const given: any = [1.5, 2.5, 3.5];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c214
unshift(7.5	unshiftMany double: " + c215
push("t"	pushMany text: " + c216
unshift("t"	unshiftMany text: " + c217
push(undefined	pushMany undefined: " + c218
unshift(undefined	unshiftMany undefined: " + c219`,
        (n, a, b) => `function c${n + 214}(): string {
    const given: any = [1.5, 2.5, 3.5];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c220
a.shift()	shift: " + c221
a.reverse()	reverse: " + c222
a.sort()	sort: " + c223
a.copyWithin(0, 1)	copyWithin: " + c224
a.splice(0, 2)	spliceOut: " + c225
a.length = 0	lengthZero: " + c226
a.slice(1)	slice: " + c227
a.map((x: unknown) => x)	map: " + c228
a.filter(() => true)	filter: " + c229
a.flat()	flat: " + c230
a.join()	join: " + c231
a.includes(3)	includes: " + c232
a.indexOf(3)	indexOf: " + c233
a.at(0)	at: " + c234
[...a]	spread: " + c235
[...a.entries()]	entries: " + c236`,
        (n, a, b) => `function c${n + 220}(): string {
    const given: any = [1.5, 2.5, 3.5];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c237	.push("t")	push text: " + c238
.push(undefined)	push undefined: " + c239	.push(7.5, 7.5)	pushTwo double: " + c240
.push("t", "t")	pushTwo text: " + c241	.push(undefined, undefined)	pushTwo undefined: " + c242
.unshift(7.5)	unshift double: " + c243	.unshift("t")	unshift text: " + c244
.unshift(undefined)	unshift undefined: " + c245	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c246
.splice(1, 0, "t", "t")	spliceIn text: " + c247	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c248
.splice(0, 1, 7.5)	spliceOver double: " + c249	.splice(0, 1, "t")	spliceOver text: " + c250
.splice(0, 1, undefined)	spliceOver undefined: " + c251	.fill(7.5)	fill double: " + c252
.fill("t")	fill text: " + c253	.fill(undefined)	fill undefined: " + c254
.fill(7.5, 1, 2)	fillPart double: " + c255	.fill("t", 1, 2)	fillPart text: " + c256
.fill(undefined, 1, 2)	fillPart undefined: " + c257	[1] = 7.5	store double: " + c258
[1] = "t"	store text: " + c259	[1] = undefined	store undefined: " + c260
[a.length] = 7.5	storeAtEnd double: " + c261	[a.length] = "t"	storeAtEnd text: " + c262
[a.length] = undefined	storeAtEnd undefined: " + c263	.with(0, 7.5)	with double: " + c264
.with(0, "t")	with text: " + c265	.with(0, undefined)	with undefined: " + c266
.concat([7.5])	concat double: " + c267	.concat(["t"])	concat text: " + c268
.concat([undefined])	concat undefined: " + c269	.toSpliced(0, 0, 7.5)	toSpliced double: " + c270
.toSpliced(0, 0, "t")	toSpliced text: " + c271	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c272`,
        (n, a, b, c, d) => `function c${2 * n + 237}(): string {
    const given: any = ["a", "b", "c"];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one ${b}());
function c${2 * n + 238}(): string {
    const given: any = ["a", "b", "c"];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c273
unshift(7.5	unshiftMany double: " + c274
push("t"	pushMany text: " + c275
unshift("t"	unshiftMany text: " + c276
push(undefined	pushMany undefined: " + c277
unshift(undefined	unshiftMany undefined: " + c278`,
        (n, a, b) => `function c${n + 273}(): string {
    const given: any = ["a", "b", "c"];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c279
a.shift()	shift: " + c280
a.reverse()	reverse: " + c281
a.sort()	sort: " + c282
a.copyWithin(0, 1)	copyWithin: " + c283
a.splice(0, 2)	spliceOut: " + c284
a.length = 0	lengthZero: " + c285
a.slice(1)	slice: " + c286
a.map((x: unknown) => x)	map: " + c287
a.filter(() => true)	filter: " + c288
a.flat()	flat: " + c289
a.join()	join: " + c290
a.includes(3)	includes: " + c291
a.indexOf(3)	indexOf: " + c292
a.at(0)	at: " + c293
[...a]	spread: " + c294
[...a.entries()]	entries: " + c295`,
        (n, a, b) => `function c${n + 279}(): string {
    const given: any = ["a", "b", "c"];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c296	.push("t")	push text: " + c297
.push(undefined)	push undefined: " + c298	.push(7.5, 7.5)	pushTwo double: " + c299
.push("t", "t")	pushTwo text: " + c300	.push(undefined, undefined)	pushTwo undefined: " + c301
.unshift(7.5)	unshift double: " + c302	.unshift("t")	unshift text: " + c303
.unshift(undefined)	unshift undefined: " + c304	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c305
.splice(1, 0, "t", "t")	spliceIn text: " + c306	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c307
.splice(0, 1, 7.5)	spliceOver double: " + c308	.splice(0, 1, "t")	spliceOver text: " + c309
.splice(0, 1, undefined)	spliceOver undefined: " + c310	.fill(7.5)	fill double: " + c311
.fill("t")	fill text: " + c312	.fill(undefined)	fill undefined: " + c313
.fill(7.5, 1, 2)	fillPart double: " + c314	.fill("t", 1, 2)	fillPart text: " + c315
.fill(undefined, 1, 2)	fillPart undefined: " + c316	[1] = 7.5	store double: " + c317
[1] = "t"	store text: " + c318	[1] = undefined	store undefined: " + c319
[a.length] = 7.5	storeAtEnd double: " + c320	[a.length] = "t"	storeAtEnd text: " + c321
[a.length] = undefined	storeAtEnd undefined: " + c322	.with(0, 7.5)	with double: " + c323
.with(0, "t")	with text: " + c324	.with(0, undefined)	with undefined: " + c325
.concat([7.5])	concat double: " + c326	.concat(["t"])	concat text: " + c327
.concat([undefined])	concat undefined: " + c328	.toSpliced(0, 0, 7.5)	toSpliced double: " + c329
.toSpliced(0, 0, "t")	toSpliced text: " + c330	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c331`,
        (n, a, b, c, d) => `function c${2 * n + 296}(): string {
    const given: any = ["a", "b", "c"];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve ${b}());
function c${2 * n + 297}(): string {
    const given: any = ["a", "b", "c"];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c332
unshift(7.5	unshiftMany double: " + c333
push("t"	pushMany text: " + c334
unshift("t"	unshiftMany text: " + c335
push(undefined	pushMany undefined: " + c336
unshift(undefined	unshiftMany undefined: " + c337`,
        (n, a, b) => `function c${n + 332}(): string {
    const given: any = ["a", "b", "c"];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c338
a.shift()	shift: " + c339
a.reverse()	reverse: " + c340
a.sort()	sort: " + c341
a.copyWithin(0, 1)	copyWithin: " + c342
a.splice(0, 2)	spliceOut: " + c343
a.length = 0	lengthZero: " + c344
a.slice(1)	slice: " + c345
a.map((x: unknown) => x)	map: " + c346
a.filter(() => true)	filter: " + c347
a.flat()	flat: " + c348
a.join()	join: " + c349
a.includes(3)	includes: " + c350
a.indexOf(3)	indexOf: " + c351
a.at(0)	at: " + c352
[...a]	spread: " + c353
[...a.entries()]	entries: " + c354`,
        (n, a, b) => `function c${n + 338}(): string {
    const given: any = ["a", "b", "c"];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c355	.push("t")	push text: " + c356
.push(undefined)	push undefined: " + c357	.push(7.5, 7.5)	pushTwo double: " + c358
.push("t", "t")	pushTwo text: " + c359	.push(undefined, undefined)	pushTwo undefined: " + c360
.unshift(7.5)	unshift double: " + c361	.unshift("t")	unshift text: " + c362
.unshift(undefined)	unshift undefined: " + c363	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c364
.splice(1, 0, "t", "t")	spliceIn text: " + c365	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c366
.splice(0, 1, 7.5)	spliceOver double: " + c367	.splice(0, 1, "t")	spliceOver text: " + c368
.splice(0, 1, undefined)	spliceOver undefined: " + c369	.fill(7.5)	fill double: " + c370
.fill("t")	fill text: " + c371	.fill(undefined)	fill undefined: " + c372
.fill(7.5, 1, 2)	fillPart double: " + c373	.fill("t", 1, 2)	fillPart text: " + c374
.fill(undefined, 1, 2)	fillPart undefined: " + c375	[1] = 7.5	store double: " + c376
[1] = "t"	store text: " + c377	[1] = undefined	store undefined: " + c378
[a.length] = 7.5	storeAtEnd double: " + c379	[a.length] = "t"	storeAtEnd text: " + c380
[a.length] = undefined	storeAtEnd undefined: " + c381	.with(0, 7.5)	with double: " + c382
.with(0, "t")	with text: " + c383	.with(0, undefined)	with undefined: " + c384
.concat([7.5])	concat double: " + c385	.concat(["t"])	concat text: " + c386
.concat([undefined])	concat undefined: " + c387	.toSpliced(0, 0, 7.5)	toSpliced double: " + c388
.toSpliced(0, 0, "t")	toSpliced text: " + c389	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c390`,
        (n, a, b, c, d) => `function c${2 * n + 355}(): string {
    const given: any = [1, "b", { c: 1 }];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one ${b}());
function c${2 * n + 356}(): string {
    const given: any = [1, "b", { c: 1 }];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c391
unshift(7.5	unshiftMany double: " + c392
push("t"	pushMany text: " + c393
unshift("t"	unshiftMany text: " + c394
push(undefined	pushMany undefined: " + c395
unshift(undefined	unshiftMany undefined: " + c396`,
        (n, a, b) => `function c${n + 391}(): string {
    const given: any = [1, "b", { c: 1 }];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c397
a.shift()	shift: " + c398
a.reverse()	reverse: " + c399
a.sort()	sort: " + c400
a.copyWithin(0, 1)	copyWithin: " + c401
a.splice(0, 2)	spliceOut: " + c402
a.length = 0	lengthZero: " + c403
a.slice(1)	slice: " + c404
a.map((x: unknown) => x)	map: " + c405
a.filter(() => true)	filter: " + c406
a.flat()	flat: " + c407
a.join()	join: " + c408
a.includes(3)	includes: " + c409
a.indexOf(3)	indexOf: " + c410
a.at(0)	at: " + c411
[...a]	spread: " + c412
[...a.entries()]	entries: " + c413`,
        (n, a, b) => `function c${n + 397}(): string {
    const given: any = [1, "b", { c: 1 }];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c414	.push("t")	push text: " + c415
.push(undefined)	push undefined: " + c416	.push(7.5, 7.5)	pushTwo double: " + c417
.push("t", "t")	pushTwo text: " + c418	.push(undefined, undefined)	pushTwo undefined: " + c419
.unshift(7.5)	unshift double: " + c420	.unshift("t")	unshift text: " + c421
.unshift(undefined)	unshift undefined: " + c422	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c423
.splice(1, 0, "t", "t")	spliceIn text: " + c424	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c425
.splice(0, 1, 7.5)	spliceOver double: " + c426	.splice(0, 1, "t")	spliceOver text: " + c427
.splice(0, 1, undefined)	spliceOver undefined: " + c428	.fill(7.5)	fill double: " + c429
.fill("t")	fill text: " + c430	.fill(undefined)	fill undefined: " + c431
.fill(7.5, 1, 2)	fillPart double: " + c432	.fill("t", 1, 2)	fillPart text: " + c433
.fill(undefined, 1, 2)	fillPart undefined: " + c434	[1] = 7.5	store double: " + c435
[1] = "t"	store text: " + c436	[1] = undefined	store undefined: " + c437
[a.length] = 7.5	storeAtEnd double: " + c438	[a.length] = "t"	storeAtEnd text: " + c439
[a.length] = undefined	storeAtEnd undefined: " + c440	.with(0, 7.5)	with double: " + c441
.with(0, "t")	with text: " + c442	.with(0, undefined)	with undefined: " + c443
.concat([7.5])	concat double: " + c444	.concat(["t"])	concat text: " + c445
.concat([undefined])	concat undefined: " + c446	.toSpliced(0, 0, 7.5)	toSpliced double: " + c447
.toSpliced(0, 0, "t")	toSpliced text: " + c448	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c449`,
        (n, a, b, c, d) => `function c${2 * n + 414}(): string {
    const given: any = [1, "b", { c: 1 }];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve ${b}());
function c${2 * n + 415}(): string {
    const given: any = [1, "b", { c: 1 }];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c450
unshift(7.5	unshiftMany double: " + c451
push("t"	pushMany text: " + c452
unshift("t"	unshiftMany text: " + c453
push(undefined	pushMany undefined: " + c454
unshift(undefined	unshiftMany undefined: " + c455`,
        (n, a, b) => `function c${n + 450}(): string {
    const given: any = [1, "b", { c: 1 }];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c456
a.shift()	shift: " + c457
a.reverse()	reverse: " + c458
a.sort()	sort: " + c459
a.copyWithin(0, 1)	copyWithin: " + c460
a.splice(0, 2)	spliceOut: " + c461
a.length = 0	lengthZero: " + c462
a.slice(1)	slice: " + c463
a.map((x: unknown) => x)	map: " + c464
a.filter(() => true)	filter: " + c465
a.flat()	flat: " + c466
a.join()	join: " + c467
a.includes(3)	includes: " + c468
a.indexOf(3)	indexOf: " + c469
a.at(0)	at: " + c470
[...a]	spread: " + c471
[...a.entries()]	entries: " + c472`,
        (n, a, b) => `function c${n + 456}(): string {
    const given: any = [1, "b", { c: 1 }];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c473	.push("t")	push text: " + c474
.push(undefined)	push undefined: " + c475	.push(7.5, 7.5)	pushTwo double: " + c476
.push("t", "t")	pushTwo text: " + c477	.push(undefined, undefined)	pushTwo undefined: " + c478
.unshift(7.5)	unshift double: " + c479	.unshift("t")	unshift text: " + c480
.unshift(undefined)	unshift undefined: " + c481	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c482
.splice(1, 0, "t", "t")	spliceIn text: " + c483	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c484
.splice(0, 1, 7.5)	spliceOver double: " + c485	.splice(0, 1, "t")	spliceOver text: " + c486
.splice(0, 1, undefined)	spliceOver undefined: " + c487	.fill(7.5)	fill double: " + c488
.fill("t")	fill text: " + c489	.fill(undefined)	fill undefined: " + c490
.fill(7.5, 1, 2)	fillPart double: " + c491	.fill("t", 1, 2)	fillPart text: " + c492
.fill(undefined, 1, 2)	fillPart undefined: " + c493	[1] = 7.5	store double: " + c494
[1] = "t"	store text: " + c495	[1] = undefined	store undefined: " + c496
[a.length] = 7.5	storeAtEnd double: " + c497	[a.length] = "t"	storeAtEnd text: " + c498
[a.length] = undefined	storeAtEnd undefined: " + c499	.with(0, 7.5)	with double: " + c500
.with(0, "t")	with text: " + c501	.with(0, undefined)	with undefined: " + c502
.concat([7.5])	concat double: " + c503	.concat(["t"])	concat text: " + c504
.concat([undefined])	concat undefined: " + c505	.toSpliced(0, 0, 7.5)	toSpliced double: " + c506
.toSpliced(0, 0, "t")	toSpliced text: " + c507	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c508`,
        (n, a, b, c, d) => `function c${2 * n + 473}(): string {
    const given: any = [];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one ${b}());
function c${2 * n + 474}(): string {
    const given: any = [];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c509
unshift(7.5	unshiftMany double: " + c510
push("t"	pushMany text: " + c511
unshift("t"	unshiftMany text: " + c512
push(undefined	pushMany undefined: " + c513
unshift(undefined	unshiftMany undefined: " + c514`,
        (n, a, b) => `function c${n + 509}(): string {
    const given: any = [];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c515
a.shift()	shift: " + c516
a.reverse()	reverse: " + c517
a.sort()	sort: " + c518
a.copyWithin(0, 1)	copyWithin: " + c519
a.splice(0, 2)	spliceOut: " + c520
a.length = 0	lengthZero: " + c521
a.slice(1)	slice: " + c522
a.map((x: unknown) => x)	map: " + c523
a.filter(() => true)	filter: " + c524
a.flat()	flat: " + c525
a.join()	join: " + c526
a.includes(3)	includes: " + c527
a.indexOf(3)	indexOf: " + c528
a.at(0)	at: " + c529
[...a]	spread: " + c530
[...a.entries()]	entries: " + c531`,
        (n, a, b) => `function c${n + 515}(): string {
    const given: any = [];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c532	.push("t")	push text: " + c533
.push(undefined)	push undefined: " + c534	.push(7.5, 7.5)	pushTwo double: " + c535
.push("t", "t")	pushTwo text: " + c536	.push(undefined, undefined)	pushTwo undefined: " + c537
.unshift(7.5)	unshift double: " + c538	.unshift("t")	unshift text: " + c539
.unshift(undefined)	unshift undefined: " + c540	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c541
.splice(1, 0, "t", "t")	spliceIn text: " + c542	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c543
.splice(0, 1, 7.5)	spliceOver double: " + c544	.splice(0, 1, "t")	spliceOver text: " + c545
.splice(0, 1, undefined)	spliceOver undefined: " + c546	.fill(7.5)	fill double: " + c547
.fill("t")	fill text: " + c548	.fill(undefined)	fill undefined: " + c549
.fill(7.5, 1, 2)	fillPart double: " + c550	.fill("t", 1, 2)	fillPart text: " + c551
.fill(undefined, 1, 2)	fillPart undefined: " + c552	[1] = 7.5	store double: " + c553
[1] = "t"	store text: " + c554	[1] = undefined	store undefined: " + c555
[a.length] = 7.5	storeAtEnd double: " + c556	[a.length] = "t"	storeAtEnd text: " + c557
[a.length] = undefined	storeAtEnd undefined: " + c558	.with(0, 7.5)	with double: " + c559
.with(0, "t")	with text: " + c560	.with(0, undefined)	with undefined: " + c561
.concat([7.5])	concat double: " + c562	.concat(["t"])	concat text: " + c563
.concat([undefined])	concat undefined: " + c564	.toSpliced(0, 0, 7.5)	toSpliced double: " + c565
.toSpliced(0, 0, "t")	toSpliced text: " + c566	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c567`,
        (n, a, b, c, d) => `function c${2 * n + 532}(): string {
    const given: any = [];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve ${b}());
function c${2 * n + 533}(): string {
    const given: any = [];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c568
unshift(7.5	unshiftMany double: " + c569
push("t"	pushMany text: " + c570
unshift("t"	unshiftMany text: " + c571
push(undefined	pushMany undefined: " + c572
unshift(undefined	unshiftMany undefined: " + c573`,
        (n, a, b) => `function c${n + 568}(): string {
    const given: any = [];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c574
a.shift()	shift: " + c575
a.reverse()	reverse: " + c576
a.sort()	sort: " + c577
a.copyWithin(0, 1)	copyWithin: " + c578
a.splice(0, 2)	spliceOut: " + c579
a.length = 0	lengthZero: " + c580
a.slice(1)	slice: " + c581
a.map((x: unknown) => x)	map: " + c582
a.filter(() => true)	filter: " + c583
a.flat()	flat: " + c584
a.join()	join: " + c585
a.includes(3)	includes: " + c586
a.indexOf(3)	indexOf: " + c587
a.at(0)	at: " + c588
[...a]	spread: " + c589
[...a.entries()]	entries: " + c590`,
        (n, a, b) => `function c${n + 574}(): string {
    const given: any = [];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c591	.push("t")	push text: " + c592
.push(undefined)	push undefined: " + c593	.push(7.5, 7.5)	pushTwo double: " + c594
.push("t", "t")	pushTwo text: " + c595	.push(undefined, undefined)	pushTwo undefined: " + c596
.unshift(7.5)	unshift double: " + c597	.unshift("t")	unshift text: " + c598
.unshift(undefined)	unshift undefined: " + c599	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c600
.splice(1, 0, "t", "t")	spliceIn text: " + c601	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c602
.splice(0, 1, 7.5)	spliceOver double: " + c603	.splice(0, 1, "t")	spliceOver text: " + c604
.splice(0, 1, undefined)	spliceOver undefined: " + c605	.fill(7.5)	fill double: " + c606
.fill("t")	fill text: " + c607	.fill(undefined)	fill undefined: " + c608
.fill(7.5, 1, 2)	fillPart double: " + c609	.fill("t", 1, 2)	fillPart text: " + c610
.fill(undefined, 1, 2)	fillPart undefined: " + c611	[1] = 7.5	store double: " + c612
[1] = "t"	store text: " + c613	[1] = undefined	store undefined: " + c614
[a.length] = 7.5	storeAtEnd double: " + c615	[a.length] = "t"	storeAtEnd text: " + c616
[a.length] = undefined	storeAtEnd undefined: " + c617	.with(0, 7.5)	with double: " + c618
.with(0, "t")	with text: " + c619	.with(0, undefined)	with undefined: " + c620
.concat([7.5])	concat double: " + c621	.concat(["t"])	concat text: " + c622
.concat([undefined])	concat undefined: " + c623	.toSpliced(0, 0, 7.5)	toSpliced double: " + c624
.toSpliced(0, 0, "t")	toSpliced text: " + c625	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c626`,
        (n, a, b, c, d) => `function c${2 * n + 591}(): string {
    const given: any = [1, , 3];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one ${b}());
function c${2 * n + 592}(): string {
    const given: any = [1, , 3];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c627
unshift(7.5	unshiftMany double: " + c628
push("t"	pushMany text: " + c629
unshift("t"	unshiftMany text: " + c630
push(undefined	pushMany undefined: " + c631
unshift(undefined	unshiftMany undefined: " + c632`,
        (n, a, b) => `function c${n + 627}(): string {
    const given: any = [1, , 3];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c633
a.shift()	shift: " + c634
a.reverse()	reverse: " + c635
a.sort()	sort: " + c636
a.copyWithin(0, 1)	copyWithin: " + c637
a.splice(0, 2)	spliceOut: " + c638
a.length = 0	lengthZero: " + c639
a.slice(1)	slice: " + c640
a.map((x: unknown) => x)	map: " + c641
a.filter(() => true)	filter: " + c642
a.flat()	flat: " + c643
a.join()	join: " + c644
a.includes(3)	includes: " + c645
a.indexOf(3)	indexOf: " + c646
a.at(0)	at: " + c647
[...a]	spread: " + c648
[...a.entries()]	entries: " + c649`,
        (n, a, b) => `function c${n + 633}(): string {
    const given: any = [1, , 3];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c650	.push("t")	push text: " + c651
.push(undefined)	push undefined: " + c652	.push(7.5, 7.5)	pushTwo double: " + c653
.push("t", "t")	pushTwo text: " + c654	.push(undefined, undefined)	pushTwo undefined: " + c655
.unshift(7.5)	unshift double: " + c656	.unshift("t")	unshift text: " + c657
.unshift(undefined)	unshift undefined: " + c658	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c659
.splice(1, 0, "t", "t")	spliceIn text: " + c660	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c661
.splice(0, 1, 7.5)	spliceOver double: " + c662	.splice(0, 1, "t")	spliceOver text: " + c663
.splice(0, 1, undefined)	spliceOver undefined: " + c664	.fill(7.5)	fill double: " + c665
.fill("t")	fill text: " + c666	.fill(undefined)	fill undefined: " + c667
.fill(7.5, 1, 2)	fillPart double: " + c668	.fill("t", 1, 2)	fillPart text: " + c669
.fill(undefined, 1, 2)	fillPart undefined: " + c670	[1] = 7.5	store double: " + c671
[1] = "t"	store text: " + c672	[1] = undefined	store undefined: " + c673
[a.length] = 7.5	storeAtEnd double: " + c674	[a.length] = "t"	storeAtEnd text: " + c675
[a.length] = undefined	storeAtEnd undefined: " + c676	.with(0, 7.5)	with double: " + c677
.with(0, "t")	with text: " + c678	.with(0, undefined)	with undefined: " + c679
.concat([7.5])	concat double: " + c680	.concat(["t"])	concat text: " + c681
.concat([undefined])	concat undefined: " + c682	.toSpliced(0, 0, 7.5)	toSpliced double: " + c683
.toSpliced(0, 0, "t")	toSpliced text: " + c684	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c685`,
        (n, a, b, c, d) => `function c${2 * n + 650}(): string {
    const given: any = [1, , 3];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve ${b}());
function c${2 * n + 651}(): string {
    const given: any = [1, , 3];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c686
unshift(7.5	unshiftMany double: " + c687
push("t"	pushMany text: " + c688
unshift("t"	unshiftMany text: " + c689
push(undefined	pushMany undefined: " + c690
unshift(undefined	unshiftMany undefined: " + c691`,
        (n, a, b) => `function c${n + 686}(): string {
    const given: any = [1, , 3];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c692
a.shift()	shift: " + c693
a.reverse()	reverse: " + c694
a.sort()	sort: " + c695
a.copyWithin(0, 1)	copyWithin: " + c696
a.splice(0, 2)	spliceOut: " + c697
a.length = 0	lengthZero: " + c698
a.slice(1)	slice: " + c699
a.map((x: unknown) => x)	map: " + c700
a.filter(() => true)	filter: " + c701
a.flat()	flat: " + c702
a.join()	join: " + c703
a.includes(3)	includes: " + c704
a.indexOf(3)	indexOf: " + c705
a.at(0)	at: " + c706
[...a]	spread: " + c707
[...a.entries()]	entries: " + c708`,
        (n, a, b) => `function c${n + 692}(): string {
    const given: any = [1, , 3];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c709	.push("t")	push text: " + c710
.push(undefined)	push undefined: " + c711	.push(7.5, 7.5)	pushTwo double: " + c712
.push("t", "t")	pushTwo text: " + c713	.push(undefined, undefined)	pushTwo undefined: " + c714
.unshift(7.5)	unshift double: " + c715	.unshift("t")	unshift text: " + c716
.unshift(undefined)	unshift undefined: " + c717	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c718
.splice(1, 0, "t", "t")	spliceIn text: " + c719	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c720
.splice(0, 1, 7.5)	spliceOver double: " + c721	.splice(0, 1, "t")	spliceOver text: " + c722
.splice(0, 1, undefined)	spliceOver undefined: " + c723	.fill(7.5)	fill double: " + c724
.fill("t")	fill text: " + c725	.fill(undefined)	fill undefined: " + c726
.fill(7.5, 1, 2)	fillPart double: " + c727	.fill("t", 1, 2)	fillPart text: " + c728
.fill(undefined, 1, 2)	fillPart undefined: " + c729	[1] = 7.5	store double: " + c730
[1] = "t"	store text: " + c731	[1] = undefined	store undefined: " + c732
[a.length] = 7.5	storeAtEnd double: " + c733	[a.length] = "t"	storeAtEnd text: " + c734
[a.length] = undefined	storeAtEnd undefined: " + c735	.with(0, 7.5)	with double: " + c736
.with(0, "t")	with text: " + c737	.with(0, undefined)	with undefined: " + c738
.concat([7.5])	concat double: " + c739	.concat(["t"])	concat text: " + c740
.concat([undefined])	concat undefined: " + c741	.toSpliced(0, 0, 7.5)	toSpliced double: " + c742
.toSpliced(0, 0, "t")	toSpliced text: " + c743	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c744`,
        (n, a, b, c, d) => `function c${2 * n + 709}(): string {
    const given: any = [1.5, , 3.5];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one ${b}());
function c${2 * n + 710}(): string {
    const given: any = [1.5, , 3.5];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c745
unshift(7.5	unshiftMany double: " + c746
push("t"	pushMany text: " + c747
unshift("t"	unshiftMany text: " + c748
push(undefined	pushMany undefined: " + c749
unshift(undefined	unshiftMany undefined: " + c750`,
        (n, a, b) => `function c${n + 745}(): string {
    const given: any = [1.5, , 3.5];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c751
a.shift()	shift: " + c752
a.reverse()	reverse: " + c753
a.sort()	sort: " + c754
a.copyWithin(0, 1)	copyWithin: " + c755
a.splice(0, 2)	spliceOut: " + c756
a.length = 0	lengthZero: " + c757
a.slice(1)	slice: " + c758
a.map((x: unknown) => x)	map: " + c759
a.filter(() => true)	filter: " + c760
a.flat()	flat: " + c761
a.join()	join: " + c762
a.includes(3)	includes: " + c763
a.indexOf(3)	indexOf: " + c764
a.at(0)	at: " + c765
[...a]	spread: " + c766
[...a.entries()]	entries: " + c767`,
        (n, a, b) => `function c${n + 751}(): string {
    const given: any = [1.5, , 3.5];
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c768	.push("t")	push text: " + c769
.push(undefined)	push undefined: " + c770	.push(7.5, 7.5)	pushTwo double: " + c771
.push("t", "t")	pushTwo text: " + c772	.push(undefined, undefined)	pushTwo undefined: " + c773
.unshift(7.5)	unshift double: " + c774	.unshift("t")	unshift text: " + c775
.unshift(undefined)	unshift undefined: " + c776	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c777
.splice(1, 0, "t", "t")	spliceIn text: " + c778	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c779
.splice(0, 1, 7.5)	spliceOver double: " + c780	.splice(0, 1, "t")	spliceOver text: " + c781
.splice(0, 1, undefined)	spliceOver undefined: " + c782	.fill(7.5)	fill double: " + c783
.fill("t")	fill text: " + c784	.fill(undefined)	fill undefined: " + c785
.fill(7.5, 1, 2)	fillPart double: " + c786	.fill("t", 1, 2)	fillPart text: " + c787
.fill(undefined, 1, 2)	fillPart undefined: " + c788	[1] = 7.5	store double: " + c789
[1] = "t"	store text: " + c790	[1] = undefined	store undefined: " + c791
[a.length] = 7.5	storeAtEnd double: " + c792	[a.length] = "t"	storeAtEnd text: " + c793
[a.length] = undefined	storeAtEnd undefined: " + c794	.with(0, 7.5)	with double: " + c795
.with(0, "t")	with text: " + c796	.with(0, undefined)	with undefined: " + c797
.concat([7.5])	concat double: " + c798	.concat(["t"])	concat text: " + c799
.concat([undefined])	concat undefined: " + c800	.toSpliced(0, 0, 7.5)	toSpliced double: " + c801
.toSpliced(0, 0, "t")	toSpliced text: " + c802	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c803`,
        (n, a, b, c, d) => `function c${2 * n + 768}(): string {
    const given: any = [1.5, , 3.5];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve ${b}());
function c${2 * n + 769}(): string {
    const given: any = [1.5, , 3.5];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c804
unshift(7.5	unshiftMany double: " + c805
push("t"	pushMany text: " + c806
unshift("t"	unshiftMany text: " + c807
push(undefined	pushMany undefined: " + c808
unshift(undefined	unshiftMany undefined: " + c809`,
        (n, a, b) => `function c${n + 804}(): string {
    const given: any = [1.5, , 3.5];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c810
a.shift()	shift: " + c811
a.reverse()	reverse: " + c812
a.sort()	sort: " + c813
a.copyWithin(0, 1)	copyWithin: " + c814
a.splice(0, 2)	spliceOut: " + c815
a.length = 0	lengthZero: " + c816
a.slice(1)	slice: " + c817
a.map((x: unknown) => x)	map: " + c818
a.filter(() => true)	filter: " + c819
a.flat()	flat: " + c820
a.join()	join: " + c821
a.includes(3)	includes: " + c822
a.indexOf(3)	indexOf: " + c823
a.at(0)	at: " + c824
[...a]	spread: " + c825
[...a.entries()]	entries: " + c826`,
        (n, a, b) => `function c${n + 810}(): string {
    const given: any = [1.5, , 3.5];
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c827	.push("t")	push text: " + c828
.push(undefined)	push undefined: " + c829	.push(7.5, 7.5)	pushTwo double: " + c830
.push("t", "t")	pushTwo text: " + c831	.push(undefined, undefined)	pushTwo undefined: " + c832
.unshift(7.5)	unshift double: " + c833	.unshift("t")	unshift text: " + c834
.unshift(undefined)	unshift undefined: " + c835	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c836
.splice(1, 0, "t", "t")	spliceIn text: " + c837	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c838
.splice(0, 1, 7.5)	spliceOver double: " + c839	.splice(0, 1, "t")	spliceOver text: " + c840
.splice(0, 1, undefined)	spliceOver undefined: " + c841	.fill(7.5)	fill double: " + c842
.fill("t")	fill text: " + c843	.fill(undefined)	fill undefined: " + c844
.fill(7.5, 1, 2)	fillPart double: " + c845	.fill("t", 1, 2)	fillPart text: " + c846
.fill(undefined, 1, 2)	fillPart undefined: " + c847	[1] = 7.5	store double: " + c848
[1] = "t"	store text: " + c849	[1] = undefined	store undefined: " + c850
[a.length] = 7.5	storeAtEnd double: " + c851	[a.length] = "t"	storeAtEnd text: " + c852
[a.length] = undefined	storeAtEnd undefined: " + c853	.with(0, 7.5)	with double: " + c854
.with(0, "t")	with text: " + c855	.with(0, undefined)	with undefined: " + c856
.concat([7.5])	concat double: " + c857	.concat(["t"])	concat text: " + c858
.concat([undefined])	concat undefined: " + c859	.toSpliced(0, 0, 7.5)	toSpliced double: " + c860
.toSpliced(0, 0, "t")	toSpliced text: " + c861	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c862`,
        (n, a, b, c, d) => `function c${2 * n + 827}(): string {
    const given: any = Array.from({ length: 40 }, (_, i) => i);
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one ${b}());
function c${2 * n + 828}(): string {
    const given: any = Array.from({ length: 40 }, (_, i) => i);
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c863
unshift(7.5	unshiftMany double: " + c864
push("t"	pushMany text: " + c865
unshift("t"	unshiftMany text: " + c866
push(undefined	pushMany undefined: " + c867
unshift(undefined	unshiftMany undefined: " + c868`,
        (n, a, b) => `function c${n + 863}(): string {
    const given: any = Array.from({ length: 40 }, (_, i) => i);
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c869
a.shift()	shift: " + c870
a.reverse()	reverse: " + c871
a.sort()	sort: " + c872
a.copyWithin(0, 1)	copyWithin: " + c873
a.splice(0, 2)	spliceOut: " + c874
a.length = 0	lengthZero: " + c875
a.slice(1)	slice: " + c876
a.map((x: unknown) => x)	map: " + c877
a.filter(() => true)	filter: " + c878
a.flat()	flat: " + c879
a.join()	join: " + c880
a.includes(3)	includes: " + c881
a.indexOf(3)	indexOf: " + c882
a.at(0)	at: " + c883
[...a]	spread: " + c884
[...a.entries()]	entries: " + c885`,
        (n, a, b) => `function c${n + 869}(): string {
    const given: any = Array.from({ length: 40 }, (_, i) => i);
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c886	.push("t")	push text: " + c887
.push(undefined)	push undefined: " + c888	.push(7.5, 7.5)	pushTwo double: " + c889
.push("t", "t")	pushTwo text: " + c890	.push(undefined, undefined)	pushTwo undefined: " + c891
.unshift(7.5)	unshift double: " + c892	.unshift("t")	unshift text: " + c893
.unshift(undefined)	unshift undefined: " + c894	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c895
.splice(1, 0, "t", "t")	spliceIn text: " + c896	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c897
.splice(0, 1, 7.5)	spliceOver double: " + c898	.splice(0, 1, "t")	spliceOver text: " + c899
.splice(0, 1, undefined)	spliceOver undefined: " + c900	.fill(7.5)	fill double: " + c901
.fill("t")	fill text: " + c902	.fill(undefined)	fill undefined: " + c903
.fill(7.5, 1, 2)	fillPart double: " + c904	.fill("t", 1, 2)	fillPart text: " + c905
.fill(undefined, 1, 2)	fillPart undefined: " + c906	[1] = 7.5	store double: " + c907
[1] = "t"	store text: " + c908	[1] = undefined	store undefined: " + c909
[a.length] = 7.5	storeAtEnd double: " + c910	[a.length] = "t"	storeAtEnd text: " + c911
[a.length] = undefined	storeAtEnd undefined: " + c912	.with(0, 7.5)	with double: " + c913
.with(0, "t")	with text: " + c914	.with(0, undefined)	with undefined: " + c915
.concat([7.5])	concat double: " + c916	.concat(["t"])	concat text: " + c917
.concat([undefined])	concat undefined: " + c918	.toSpliced(0, 0, 7.5)	toSpliced double: " + c919
.toSpliced(0, 0, "t")	toSpliced text: " + c920	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c921`,
        (n, a, b, c, d) => `function c${2 * n + 886}(): string {
    const given: any = Array.from({ length: 40 }, (_, i) => i);
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve ${b}());
function c${2 * n + 887}(): string {
    const given: any = Array.from({ length: 40 }, (_, i) => i);
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c922
unshift(7.5	unshiftMany double: " + c923
push("t"	pushMany text: " + c924
unshift("t"	unshiftMany text: " + c925
push(undefined	pushMany undefined: " + c926
unshift(undefined	unshiftMany undefined: " + c927`,
        (n, a, b) => `function c${n + 922}(): string {
    const given: any = Array.from({ length: 40 }, (_, i) => i);
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c928
a.shift()	shift: " + c929
a.reverse()	reverse: " + c930
a.sort()	sort: " + c931
a.copyWithin(0, 1)	copyWithin: " + c932
a.splice(0, 2)	spliceOut: " + c933
a.length = 0	lengthZero: " + c934
a.slice(1)	slice: " + c935
a.map((x: unknown) => x)	map: " + c936
a.filter(() => true)	filter: " + c937
a.flat()	flat: " + c938
a.join()	join: " + c939
a.includes(3)	includes: " + c940
a.indexOf(3)	indexOf: " + c941
a.at(0)	at: " + c942
[...a]	spread: " + c943
[...a.entries()]	entries: " + c944`,
        (n, a, b) => `function c${n + 928}(): string {
    const given: any = Array.from({ length: 40 }, (_, i) => i);
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c945	.push("t")	push text: " + c946
.push(undefined)	push undefined: " + c947	.push(7.5, 7.5)	pushTwo double: " + c948
.push("t", "t")	pushTwo text: " + c949	.push(undefined, undefined)	pushTwo undefined: " + c950
.unshift(7.5)	unshift double: " + c951	.unshift("t")	unshift text: " + c952
.unshift(undefined)	unshift undefined: " + c953	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c954
.splice(1, 0, "t", "t")	spliceIn text: " + c955	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c956
.splice(0, 1, 7.5)	spliceOver double: " + c957	.splice(0, 1, "t")	spliceOver text: " + c958
.splice(0, 1, undefined)	spliceOver undefined: " + c959	.fill(7.5)	fill double: " + c960
.fill("t")	fill text: " + c961	.fill(undefined)	fill undefined: " + c962
.fill(7.5, 1, 2)	fillPart double: " + c963	.fill("t", 1, 2)	fillPart text: " + c964
.fill(undefined, 1, 2)	fillPart undefined: " + c965	[1] = 7.5	store double: " + c966
[1] = "t"	store text: " + c967	[1] = undefined	store undefined: " + c968
[a.length] = 7.5	storeAtEnd double: " + c969	[a.length] = "t"	storeAtEnd text: " + c970
[a.length] = undefined	storeAtEnd undefined: " + c971	.with(0, 7.5)	with double: " + c972
.with(0, "t")	with text: " + c973	.with(0, undefined)	with undefined: " + c974
.concat([7.5])	concat double: " + c975	.concat(["t"])	concat text: " + c976
.concat([undefined])	concat undefined: " + c977	.toSpliced(0, 0, 7.5)	toSpliced double: " + c978
.toSpliced(0, 0, "t")	toSpliced text: " + c979	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c980`,
        (n, a, b, c, d) => `function c${2 * n + 945}(): string {
    const given: any = new Array(5);
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one ${b}());
function c${2 * n + 946}(): string {
    const given: any = new Array(5);
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c981
unshift(7.5	unshiftMany double: " + c982
push("t"	pushMany text: " + c983
unshift("t"	unshiftMany text: " + c984
push(undefined	pushMany undefined: " + c985
unshift(undefined	unshiftMany undefined: " + c986`,
        (n, a, b) => `function c${n + 981}(): string {
    const given: any = new Array(5);
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c987
a.shift()	shift: " + c988
a.reverse()	reverse: " + c989
a.sort()	sort: " + c990
a.copyWithin(0, 1)	copyWithin: " + c991
a.splice(0, 2)	spliceOut: " + c992
a.length = 0	lengthZero: " + c993
a.slice(1)	slice: " + c994
a.map((x: unknown) => x)	map: " + c995
a.filter(() => true)	filter: " + c996
a.flat()	flat: " + c997
a.join()	join: " + c998
a.includes(3)	includes: " + c999
a.indexOf(3)	indexOf: " + c1000
a.at(0)	at: " + c1001
[...a]	spread: " + c1002
[...a.entries()]	entries: " + c1003`,
        (n, a, b) => `function c${n + 987}(): string {
    const given: any = new Array(5);
    const a: any = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c1004	.push("t")	push text: " + c1005
.push(undefined)	push undefined: " + c1006	.push(7.5, 7.5)	pushTwo double: " + c1007
.push("t", "t")	pushTwo text: " + c1008	.push(undefined, undefined)	pushTwo undefined: " + c1009
.unshift(7.5)	unshift double: " + c1010	.unshift("t")	unshift text: " + c1011
.unshift(undefined)	unshift undefined: " + c1012	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c1013
.splice(1, 0, "t", "t")	spliceIn text: " + c1014	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c1015
.splice(0, 1, 7.5)	spliceOver double: " + c1016	.splice(0, 1, "t")	spliceOver text: " + c1017
.splice(0, 1, undefined)	spliceOver undefined: " + c1018	.fill(7.5)	fill double: " + c1019
.fill("t")	fill text: " + c1020	.fill(undefined)	fill undefined: " + c1021
.fill(7.5, 1, 2)	fillPart double: " + c1022	.fill("t", 1, 2)	fillPart text: " + c1023
.fill(undefined, 1, 2)	fillPart undefined: " + c1024	[1] = 7.5	store double: " + c1025
[1] = "t"	store text: " + c1026	[1] = undefined	store undefined: " + c1027
[a.length] = 7.5	storeAtEnd double: " + c1028	[a.length] = "t"	storeAtEnd text: " + c1029
[a.length] = undefined	storeAtEnd undefined: " + c1030	.with(0, 7.5)	with double: " + c1031
.with(0, "t")	with text: " + c1032	.with(0, undefined)	with undefined: " + c1033
.concat([7.5])	concat double: " + c1034	.concat(["t"])	concat text: " + c1035
.concat([undefined])	concat undefined: " + c1036	.toSpliced(0, 0, 7.5)	toSpliced double: " + c1037
.toSpliced(0, 0, "t")	toSpliced text: " + c1038	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c1039`,
        (n, a, b, c, d) => `function c${2 * n + 1004}(): string {
    const given: any = new Array(5);
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve ${b}());
function c${2 * n + 1005}(): string {
    const given: any = new Array(5);
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c1040
unshift(7.5	unshiftMany double: " + c1041
push("t"	pushMany text: " + c1042
unshift("t"	unshiftMany text: " + c1043
push(undefined	pushMany undefined: " + c1044
unshift(undefined	unshiftMany undefined: " + c1045`,
        (n, a, b) => `function c${n + 1040}(): string {
    const given: any = new Array(5);
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c1046
a.shift()	shift: " + c1047
a.reverse()	reverse: " + c1048
a.sort()	sort: " + c1049
a.copyWithin(0, 1)	copyWithin: " + c1050
a.splice(0, 2)	spliceOut: " + c1051
a.length = 0	lengthZero: " + c1052
a.slice(1)	slice: " + c1053
a.map((x: unknown) => x)	map: " + c1054
a.filter(() => true)	filter: " + c1055
a.flat()	flat: " + c1056
a.join()	join: " + c1057
a.includes(3)	includes: " + c1058
a.indexOf(3)	indexOf: " + c1059
a.at(0)	at: " + c1060
[...a]	spread: " + c1061
[...a.entries()]	entries: " + c1062`,
        (n, a, b) => `function c${n + 1046}(): string {
    const given: any = new Array(5);
    const a: any = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve ${b}());`,
      ],
      `console.log(lines.join("\\n"));
`,
    ),
    "named-properties-under-mutators.ts": text(
      `
function show(v: unknown): string {
    if (Array.isArray(v)) {
        const parts: string[] = [];
        for (let i = 0; i < v.length && i < 12; i++) parts.push(i in v ? show(v[i]) : "hole");
        const own = Object.getOwnPropertyNames(v).filter(k => k !== "length" && !/^\\d+$/.test(k));
        return "[" + parts.join(",") + (v.length > 12 ? ",.. " + v.length + " .." + show(v[v.length - 1]) : "") + "]" + (own.length ? "{" + own.map(k => k + "=" + show((v as any)[k])).join(",") + "}" : "");
    }
    if (v === undefined) return "undefined";
    if (v === null) return "null";
    if (typeof v === "object") return "{" + Object.keys(v as object).join(",") + "}";
    return typeof v === "string" ? JSON.stringify(v) : String(v);
}
function thrown(e: unknown): string { return "throws " + (e instanceof Error ? e.constructor.name : show(e)); }
const lines: string[] = [];
let kept: unknown[] = [];
function churn(): void { for (let i = 0; i < 200; i++) kept[i % 7] = [i, { i }, "s" + i]; }

const holders: Array<(x: any) => any> = [x => x, x => x];
function holder(x: any): any { return holders[Date.now() > 0 ? 0 : 1](x); }`,
      [
        `.push(7.5)	push double: " + c1	.push("t")	push text: " + c2
.push(undefined)	push undefined: " + c3	.push(7.5, 7.5)	pushTwo double: " + c4
.push("t", "t")	pushTwo text: " + c5	.push(undefined, undefined)	pushTwo undefined: " + c6
.unshift(7.5)	unshift double: " + c7	.unshift("t")	unshift text: " + c8
.unshift(undefined)	unshift undefined: " + c9	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c10
.splice(1, 0, "t", "t")	spliceIn text: " + c11	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c12
.splice(0, 1, 7.5)	spliceOver double: " + c13	.splice(0, 1, "t")	spliceOver text: " + c14
.splice(0, 1, undefined)	spliceOver undefined: " + c15	.fill(7.5)	fill double: " + c16
.fill("t")	fill text: " + c17	.fill(undefined)	fill undefined: " + c18
.fill(7.5, 1, 2)	fillPart double: " + c19	.fill("t", 1, 2)	fillPart text: " + c20
.fill(undefined, 1, 2)	fillPart undefined: " + c21	[1] = 7.5	store double: " + c22
[1] = "t"	store text: " + c23	[1] = undefined	store undefined: " + c24
[a.length] = 7.5	storeAtEnd double: " + c25	[a.length] = "t"	storeAtEnd text: " + c26
[a.length] = undefined	storeAtEnd undefined: " + c27	.with(0, 7.5)	with double: " + c28
.with(0, "t")	with text: " + c29	.with(0, undefined)	with undefined: " + c30
.concat([7.5])	concat double: " + c31	.concat(["t"])	concat text: " + c32
.concat([undefined])	concat undefined: " + c33	.toSpliced(0, 0, 7.5)	toSpliced double: " + c34
.toSpliced(0, 0, "t")	toSpliced text: " + c35	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c36`,
        (n, a, b, c, d) => `function c${2 * n + 1}(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one ${b}());
function c${2 * n + 2}(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c37
unshift(7.5	unshiftMany double: " + c38
push("t"	pushMany text: " + c39
unshift("t"	unshiftMany text: " + c40
push(undefined	pushMany undefined: " + c41
unshift(undefined	unshiftMany undefined: " + c42`,
        (n, a, b) => `function c${n + 37}(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c43
a.shift()	shift: " + c44
a.reverse()	reverse: " + c45
a.sort()	sort: " + c46
a.copyWithin(0, 1)	copyWithin: " + c47
a.splice(0, 2)	spliceOut: " + c48
a.length = 0	lengthZero: " + c49
a.slice(1)	slice: " + c50
a.map((x: unknown) => x)	map: " + c51
a.filter(() => true)	filter: " + c52
a.flat()	flat: " + c53
a.join()	join: " + c54
a.includes(3)	includes: " + c55
a.indexOf(3)	indexOf: " + c56
a.at(0)	at: " + c57
[...a]	spread: " + c58
[...a.entries()]	entries: " + c59`,
        (n, a, b) => `function c${n + 43}(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c60	.push("t")	push text: " + c61
.push(undefined)	push undefined: " + c62	.push(7.5, 7.5)	pushTwo double: " + c63
.push("t", "t")	pushTwo text: " + c64	.push(undefined, undefined)	pushTwo undefined: " + c65
.unshift(7.5)	unshift double: " + c66	.unshift("t")	unshift text: " + c67
.unshift(undefined)	unshift undefined: " + c68	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c69
.splice(1, 0, "t", "t")	spliceIn text: " + c70	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c71
.splice(0, 1, 7.5)	spliceOver double: " + c72	.splice(0, 1, "t")	spliceOver text: " + c73
.splice(0, 1, undefined)	spliceOver undefined: " + c74	.fill(7.5)	fill double: " + c75
.fill("t")	fill text: " + c76	.fill(undefined)	fill undefined: " + c77
.fill(7.5, 1, 2)	fillPart double: " + c78	.fill("t", 1, 2)	fillPart text: " + c79
.fill(undefined, 1, 2)	fillPart undefined: " + c80	[1] = 7.5	store double: " + c81
[1] = "t"	store text: " + c82	[1] = undefined	store undefined: " + c83
[a.length] = 7.5	storeAtEnd double: " + c84	[a.length] = "t"	storeAtEnd text: " + c85
[a.length] = undefined	storeAtEnd undefined: " + c86	.with(0, 7.5)	with double: " + c87
.with(0, "t")	with text: " + c88	.with(0, undefined)	with undefined: " + c89
.concat([7.5])	concat double: " + c90	.concat(["t"])	concat text: " + c91
.concat([undefined])	concat undefined: " + c92	.toSpliced(0, 0, 7.5)	toSpliced double: " + c93
.toSpliced(0, 0, "t")	toSpliced text: " + c94	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c95`,
        (n, a, b, c, d) => `function c${2 * n + 60}(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve ${b}());
function c${2 * n + 61}(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c96
unshift(7.5	unshiftMany double: " + c97
push("t"	pushMany text: " + c98
unshift("t"	unshiftMany text: " + c99
push(undefined	pushMany undefined: " + c100
unshift(undefined	unshiftMany undefined: " + c101`,
        (n, a, b) => `function c${n + 96}(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("int32 twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c102
a.shift()	shift: " + c103
a.reverse()	reverse: " + c104
a.sort()	sort: " + c105
a.copyWithin(0, 1)	copyWithin: " + c106
a.splice(0, 2)	spliceOut: " + c107
a.length = 0	lengthZero: " + c108
a.slice(1)	slice: " + c109
a.map((x: unknown) => x)	map: " + c110
a.filter(() => true)	filter: " + c111
a.flat()	flat: " + c112
a.join()	join: " + c113
a.includes(3)	includes: " + c114
a.indexOf(3)	indexOf: " + c115
a.at(0)	at: " + c116
[...a]	spread: " + c117
[...a.entries()]	entries: " + c118`,
        (n, a, b) => `function c${n + 102}(): string {
    const given: any[] = [1, 2, 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("int32 twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c119	.push("t")	push text: " + c120
.push(undefined)	push undefined: " + c121	.push(7.5, 7.5)	pushTwo double: " + c122
.push("t", "t")	pushTwo text: " + c123	.push(undefined, undefined)	pushTwo undefined: " + c124
.unshift(7.5)	unshift double: " + c125	.unshift("t")	unshift text: " + c126
.unshift(undefined)	unshift undefined: " + c127	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c128
.splice(1, 0, "t", "t")	spliceIn text: " + c129	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c130
.splice(0, 1, 7.5)	spliceOver double: " + c131	.splice(0, 1, "t")	spliceOver text: " + c132
.splice(0, 1, undefined)	spliceOver undefined: " + c133	.fill(7.5)	fill double: " + c134
.fill("t")	fill text: " + c135	.fill(undefined)	fill undefined: " + c136
.fill(7.5, 1, 2)	fillPart double: " + c137	.fill("t", 1, 2)	fillPart text: " + c138
.fill(undefined, 1, 2)	fillPart undefined: " + c139	[1] = 7.5	store double: " + c140
[1] = "t"	store text: " + c141	[1] = undefined	store undefined: " + c142
[a.length] = 7.5	storeAtEnd double: " + c143	[a.length] = "t"	storeAtEnd text: " + c144
[a.length] = undefined	storeAtEnd undefined: " + c145	.with(0, 7.5)	with double: " + c146
.with(0, "t")	with text: " + c147	.with(0, undefined)	with undefined: " + c148
.concat([7.5])	concat double: " + c149	.concat(["t"])	concat text: " + c150
.concat([undefined])	concat undefined: " + c151	.toSpliced(0, 0, 7.5)	toSpliced double: " + c152
.toSpliced(0, 0, "t")	toSpliced text: " + c153	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c154`,
        (n, a, b, c, d) => `function c${2 * n + 119}(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one ${b}());
function c${2 * n + 120}(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c155
unshift(7.5	unshiftMany double: " + c156
push("t"	pushMany text: " + c157
unshift("t"	unshiftMany text: " + c158
push(undefined	pushMany undefined: " + c159
unshift(undefined	unshiftMany undefined: " + c160`,
        (n, a, b) => `function c${n + 155}(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c161
a.shift()	shift: " + c162
a.reverse()	reverse: " + c163
a.sort()	sort: " + c164
a.copyWithin(0, 1)	copyWithin: " + c165
a.splice(0, 2)	spliceOut: " + c166
a.length = 0	lengthZero: " + c167
a.slice(1)	slice: " + c168
a.map((x: unknown) => x)	map: " + c169
a.filter(() => true)	filter: " + c170
a.flat()	flat: " + c171
a.join()	join: " + c172
a.includes(3)	includes: " + c173
a.indexOf(3)	indexOf: " + c174
a.at(0)	at: " + c175
[...a]	spread: " + c176
[...a.entries()]	entries: " + c177`,
        (n, a, b) => `function c${n + 161}(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c178	.push("t")	push text: " + c179
.push(undefined)	push undefined: " + c180	.push(7.5, 7.5)	pushTwo double: " + c181
.push("t", "t")	pushTwo text: " + c182	.push(undefined, undefined)	pushTwo undefined: " + c183
.unshift(7.5)	unshift double: " + c184	.unshift("t")	unshift text: " + c185
.unshift(undefined)	unshift undefined: " + c186	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c187
.splice(1, 0, "t", "t")	spliceIn text: " + c188	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c189
.splice(0, 1, 7.5)	spliceOver double: " + c190	.splice(0, 1, "t")	spliceOver text: " + c191
.splice(0, 1, undefined)	spliceOver undefined: " + c192	.fill(7.5)	fill double: " + c193
.fill("t")	fill text: " + c194	.fill(undefined)	fill undefined: " + c195
.fill(7.5, 1, 2)	fillPart double: " + c196	.fill("t", 1, 2)	fillPart text: " + c197
.fill(undefined, 1, 2)	fillPart undefined: " + c198	[1] = 7.5	store double: " + c199
[1] = "t"	store text: " + c200	[1] = undefined	store undefined: " + c201
[a.length] = 7.5	storeAtEnd double: " + c202	[a.length] = "t"	storeAtEnd text: " + c203
[a.length] = undefined	storeAtEnd undefined: " + c204	.with(0, 7.5)	with double: " + c205
.with(0, "t")	with text: " + c206	.with(0, undefined)	with undefined: " + c207
.concat([7.5])	concat double: " + c208	.concat(["t"])	concat text: " + c209
.concat([undefined])	concat undefined: " + c210	.toSpliced(0, 0, 7.5)	toSpliced double: " + c211
.toSpliced(0, 0, "t")	toSpliced text: " + c212	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c213`,
        (n, a, b, c, d) => `function c${2 * n + 178}(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve ${b}());
function c${2 * n + 179}(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c214
unshift(7.5	unshiftMany double: " + c215
push("t"	pushMany text: " + c216
unshift("t"	unshiftMany text: " + c217
push(undefined	pushMany undefined: " + c218
unshift(undefined	unshiftMany undefined: " + c219`,
        (n, a, b) => `function c${n + 214}(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("double twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c220
a.shift()	shift: " + c221
a.reverse()	reverse: " + c222
a.sort()	sort: " + c223
a.copyWithin(0, 1)	copyWithin: " + c224
a.splice(0, 2)	spliceOut: " + c225
a.length = 0	lengthZero: " + c226
a.slice(1)	slice: " + c227
a.map((x: unknown) => x)	map: " + c228
a.filter(() => true)	filter: " + c229
a.flat()	flat: " + c230
a.join()	join: " + c231
a.includes(3)	includes: " + c232
a.indexOf(3)	indexOf: " + c233
a.at(0)	at: " + c234
[...a]	spread: " + c235
[...a.entries()]	entries: " + c236`,
        (n, a, b) => `function c${n + 220}(): string {
    const given: any[] = [1.5, 2.5, 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("double twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c237	.push("t")	push text: " + c238
.push(undefined)	push undefined: " + c239	.push(7.5, 7.5)	pushTwo double: " + c240
.push("t", "t")	pushTwo text: " + c241	.push(undefined, undefined)	pushTwo undefined: " + c242
.unshift(7.5)	unshift double: " + c243	.unshift("t")	unshift text: " + c244
.unshift(undefined)	unshift undefined: " + c245	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c246
.splice(1, 0, "t", "t")	spliceIn text: " + c247	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c248
.splice(0, 1, 7.5)	spliceOver double: " + c249	.splice(0, 1, "t")	spliceOver text: " + c250
.splice(0, 1, undefined)	spliceOver undefined: " + c251	.fill(7.5)	fill double: " + c252
.fill("t")	fill text: " + c253	.fill(undefined)	fill undefined: " + c254
.fill(7.5, 1, 2)	fillPart double: " + c255	.fill("t", 1, 2)	fillPart text: " + c256
.fill(undefined, 1, 2)	fillPart undefined: " + c257	[1] = 7.5	store double: " + c258
[1] = "t"	store text: " + c259	[1] = undefined	store undefined: " + c260
[a.length] = 7.5	storeAtEnd double: " + c261	[a.length] = "t"	storeAtEnd text: " + c262
[a.length] = undefined	storeAtEnd undefined: " + c263	.with(0, 7.5)	with double: " + c264
.with(0, "t")	with text: " + c265	.with(0, undefined)	with undefined: " + c266
.concat([7.5])	concat double: " + c267	.concat(["t"])	concat text: " + c268
.concat([undefined])	concat undefined: " + c269	.toSpliced(0, 0, 7.5)	toSpliced double: " + c270
.toSpliced(0, 0, "t")	toSpliced text: " + c271	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c272`,
        (n, a, b, c, d) => `function c${2 * n + 237}(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one ${b}());
function c${2 * n + 238}(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c273
unshift(7.5	unshiftMany double: " + c274
push("t"	pushMany text: " + c275
unshift("t"	unshiftMany text: " + c276
push(undefined	pushMany undefined: " + c277
unshift(undefined	unshiftMany undefined: " + c278`,
        (n, a, b) => `function c${n + 273}(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c279
a.shift()	shift: " + c280
a.reverse()	reverse: " + c281
a.sort()	sort: " + c282
a.copyWithin(0, 1)	copyWithin: " + c283
a.splice(0, 2)	spliceOut: " + c284
a.length = 0	lengthZero: " + c285
a.slice(1)	slice: " + c286
a.map((x: unknown) => x)	map: " + c287
a.filter(() => true)	filter: " + c288
a.flat()	flat: " + c289
a.join()	join: " + c290
a.includes(3)	includes: " + c291
a.indexOf(3)	indexOf: " + c292
a.at(0)	at: " + c293
[...a]	spread: " + c294
[...a.entries()]	entries: " + c295`,
        (n, a, b) => `function c${n + 279}(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c296	.push("t")	push text: " + c297
.push(undefined)	push undefined: " + c298	.push(7.5, 7.5)	pushTwo double: " + c299
.push("t", "t")	pushTwo text: " + c300	.push(undefined, undefined)	pushTwo undefined: " + c301
.unshift(7.5)	unshift double: " + c302	.unshift("t")	unshift text: " + c303
.unshift(undefined)	unshift undefined: " + c304	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c305
.splice(1, 0, "t", "t")	spliceIn text: " + c306	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c307
.splice(0, 1, 7.5)	spliceOver double: " + c308	.splice(0, 1, "t")	spliceOver text: " + c309
.splice(0, 1, undefined)	spliceOver undefined: " + c310	.fill(7.5)	fill double: " + c311
.fill("t")	fill text: " + c312	.fill(undefined)	fill undefined: " + c313
.fill(7.5, 1, 2)	fillPart double: " + c314	.fill("t", 1, 2)	fillPart text: " + c315
.fill(undefined, 1, 2)	fillPart undefined: " + c316	[1] = 7.5	store double: " + c317
[1] = "t"	store text: " + c318	[1] = undefined	store undefined: " + c319
[a.length] = 7.5	storeAtEnd double: " + c320	[a.length] = "t"	storeAtEnd text: " + c321
[a.length] = undefined	storeAtEnd undefined: " + c322	.with(0, 7.5)	with double: " + c323
.with(0, "t")	with text: " + c324	.with(0, undefined)	with undefined: " + c325
.concat([7.5])	concat double: " + c326	.concat(["t"])	concat text: " + c327
.concat([undefined])	concat undefined: " + c328	.toSpliced(0, 0, 7.5)	toSpliced double: " + c329
.toSpliced(0, 0, "t")	toSpliced text: " + c330	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c331`,
        (n, a, b, c, d) => `function c${2 * n + 296}(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve ${b}());
function c${2 * n + 297}(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c332
unshift(7.5	unshiftMany double: " + c333
push("t"	pushMany text: " + c334
unshift("t"	unshiftMany text: " + c335
push(undefined	pushMany undefined: " + c336
unshift(undefined	unshiftMany undefined: " + c337`,
        (n, a, b) => `function c${n + 332}(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("values twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c338
a.shift()	shift: " + c339
a.reverse()	reverse: " + c340
a.sort()	sort: " + c341
a.copyWithin(0, 1)	copyWithin: " + c342
a.splice(0, 2)	spliceOut: " + c343
a.length = 0	lengthZero: " + c344
a.slice(1)	slice: " + c345
a.map((x: unknown) => x)	map: " + c346
a.filter(() => true)	filter: " + c347
a.flat()	flat: " + c348
a.join()	join: " + c349
a.includes(3)	includes: " + c350
a.indexOf(3)	indexOf: " + c351
a.at(0)	at: " + c352
[...a]	spread: " + c353
[...a.entries()]	entries: " + c354`,
        (n, a, b) => `function c${n + 338}(): string {
    const given: any[] = ["a", "b", "c"];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("values twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c355	.push("t")	push text: " + c356
.push(undefined)	push undefined: " + c357	.push(7.5, 7.5)	pushTwo double: " + c358
.push("t", "t")	pushTwo text: " + c359	.push(undefined, undefined)	pushTwo undefined: " + c360
.unshift(7.5)	unshift double: " + c361	.unshift("t")	unshift text: " + c362
.unshift(undefined)	unshift undefined: " + c363	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c364
.splice(1, 0, "t", "t")	spliceIn text: " + c365	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c366
.splice(0, 1, 7.5)	spliceOver double: " + c367	.splice(0, 1, "t")	spliceOver text: " + c368
.splice(0, 1, undefined)	spliceOver undefined: " + c369	.fill(7.5)	fill double: " + c370
.fill("t")	fill text: " + c371	.fill(undefined)	fill undefined: " + c372
.fill(7.5, 1, 2)	fillPart double: " + c373	.fill("t", 1, 2)	fillPart text: " + c374
.fill(undefined, 1, 2)	fillPart undefined: " + c375	[1] = 7.5	store double: " + c376
[1] = "t"	store text: " + c377	[1] = undefined	store undefined: " + c378
[a.length] = 7.5	storeAtEnd double: " + c379	[a.length] = "t"	storeAtEnd text: " + c380
[a.length] = undefined	storeAtEnd undefined: " + c381	.with(0, 7.5)	with double: " + c382
.with(0, "t")	with text: " + c383	.with(0, undefined)	with undefined: " + c384
.concat([7.5])	concat double: " + c385	.concat(["t"])	concat text: " + c386
.concat([undefined])	concat undefined: " + c387	.toSpliced(0, 0, 7.5)	toSpliced double: " + c388
.toSpliced(0, 0, "t")	toSpliced text: " + c389	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c390`,
        (n, a, b, c, d) => `function c${2 * n + 355}(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one ${b}());
function c${2 * n + 356}(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c391
unshift(7.5	unshiftMany double: " + c392
push("t"	pushMany text: " + c393
unshift("t"	unshiftMany text: " + c394
push(undefined	pushMany undefined: " + c395
unshift(undefined	unshiftMany undefined: " + c396`,
        (n, a, b) => `function c${n + 391}(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c397
a.shift()	shift: " + c398
a.reverse()	reverse: " + c399
a.sort()	sort: " + c400
a.copyWithin(0, 1)	copyWithin: " + c401
a.splice(0, 2)	spliceOut: " + c402
a.length = 0	lengthZero: " + c403
a.slice(1)	slice: " + c404
a.map((x: unknown) => x)	map: " + c405
a.filter(() => true)	filter: " + c406
a.flat()	flat: " + c407
a.join()	join: " + c408
a.includes(3)	includes: " + c409
a.indexOf(3)	indexOf: " + c410
a.at(0)	at: " + c411
[...a]	spread: " + c412
[...a.entries()]	entries: " + c413`,
        (n, a, b) => `function c${n + 397}(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c414	.push("t")	push text: " + c415
.push(undefined)	push undefined: " + c416	.push(7.5, 7.5)	pushTwo double: " + c417
.push("t", "t")	pushTwo text: " + c418	.push(undefined, undefined)	pushTwo undefined: " + c419
.unshift(7.5)	unshift double: " + c420	.unshift("t")	unshift text: " + c421
.unshift(undefined)	unshift undefined: " + c422	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c423
.splice(1, 0, "t", "t")	spliceIn text: " + c424	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c425
.splice(0, 1, 7.5)	spliceOver double: " + c426	.splice(0, 1, "t")	spliceOver text: " + c427
.splice(0, 1, undefined)	spliceOver undefined: " + c428	.fill(7.5)	fill double: " + c429
.fill("t")	fill text: " + c430	.fill(undefined)	fill undefined: " + c431
.fill(7.5, 1, 2)	fillPart double: " + c432	.fill("t", 1, 2)	fillPart text: " + c433
.fill(undefined, 1, 2)	fillPart undefined: " + c434	[1] = 7.5	store double: " + c435
[1] = "t"	store text: " + c436	[1] = undefined	store undefined: " + c437
[a.length] = 7.5	storeAtEnd double: " + c438	[a.length] = "t"	storeAtEnd text: " + c439
[a.length] = undefined	storeAtEnd undefined: " + c440	.with(0, 7.5)	with double: " + c441
.with(0, "t")	with text: " + c442	.with(0, undefined)	with undefined: " + c443
.concat([7.5])	concat double: " + c444	.concat(["t"])	concat text: " + c445
.concat([undefined])	concat undefined: " + c446	.toSpliced(0, 0, 7.5)	toSpliced double: " + c447
.toSpliced(0, 0, "t")	toSpliced text: " + c448	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c449`,
        (n, a, b, c, d) => `function c${2 * n + 414}(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve ${b}());
function c${2 * n + 415}(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c450
unshift(7.5	unshiftMany double: " + c451
push("t"	pushMany text: " + c452
unshift("t"	unshiftMany text: " + c453
push(undefined	pushMany undefined: " + c454
unshift(undefined	unshiftMany undefined: " + c455`,
        (n, a, b) => `function c${n + 450}(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("mixed twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c456
a.shift()	shift: " + c457
a.reverse()	reverse: " + c458
a.sort()	sort: " + c459
a.copyWithin(0, 1)	copyWithin: " + c460
a.splice(0, 2)	spliceOut: " + c461
a.length = 0	lengthZero: " + c462
a.slice(1)	slice: " + c463
a.map((x: unknown) => x)	map: " + c464
a.filter(() => true)	filter: " + c465
a.flat()	flat: " + c466
a.join()	join: " + c467
a.includes(3)	includes: " + c468
a.indexOf(3)	indexOf: " + c469
a.at(0)	at: " + c470
[...a]	spread: " + c471
[...a.entries()]	entries: " + c472`,
        (n, a, b) => `function c${n + 456}(): string {
    const given: any[] = [1, "b", { c: 1 }];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("mixed twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c473	.push("t")	push text: " + c474
.push(undefined)	push undefined: " + c475	.push(7.5, 7.5)	pushTwo double: " + c476
.push("t", "t")	pushTwo text: " + c477	.push(undefined, undefined)	pushTwo undefined: " + c478
.unshift(7.5)	unshift double: " + c479	.unshift("t")	unshift text: " + c480
.unshift(undefined)	unshift undefined: " + c481	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c482
.splice(1, 0, "t", "t")	spliceIn text: " + c483	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c484
.splice(0, 1, 7.5)	spliceOver double: " + c485	.splice(0, 1, "t")	spliceOver text: " + c486
.splice(0, 1, undefined)	spliceOver undefined: " + c487	.fill(7.5)	fill double: " + c488
.fill("t")	fill text: " + c489	.fill(undefined)	fill undefined: " + c490
.fill(7.5, 1, 2)	fillPart double: " + c491	.fill("t", 1, 2)	fillPart text: " + c492
.fill(undefined, 1, 2)	fillPart undefined: " + c493	[1] = 7.5	store double: " + c494
[1] = "t"	store text: " + c495	[1] = undefined	store undefined: " + c496
[a.length] = 7.5	storeAtEnd double: " + c497	[a.length] = "t"	storeAtEnd text: " + c498
[a.length] = undefined	storeAtEnd undefined: " + c499	.with(0, 7.5)	with double: " + c500
.with(0, "t")	with text: " + c501	.with(0, undefined)	with undefined: " + c502
.concat([7.5])	concat double: " + c503	.concat(["t"])	concat text: " + c504
.concat([undefined])	concat undefined: " + c505	.toSpliced(0, 0, 7.5)	toSpliced double: " + c506
.toSpliced(0, 0, "t")	toSpliced text: " + c507	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c508`,
        (n, a, b, c, d) => `function c${2 * n + 473}(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one ${b}());
function c${2 * n + 474}(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c509
unshift(7.5	unshiftMany double: " + c510
push("t"	pushMany text: " + c511
unshift("t"	unshiftMany text: " + c512
push(undefined	pushMany undefined: " + c513
unshift(undefined	unshiftMany undefined: " + c514`,
        (n, a, b) => `function c${n + 509}(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c515
a.shift()	shift: " + c516
a.reverse()	reverse: " + c517
a.sort()	sort: " + c518
a.copyWithin(0, 1)	copyWithin: " + c519
a.splice(0, 2)	spliceOut: " + c520
a.length = 0	lengthZero: " + c521
a.slice(1)	slice: " + c522
a.map((x: unknown) => x)	map: " + c523
a.filter(() => true)	filter: " + c524
a.flat()	flat: " + c525
a.join()	join: " + c526
a.includes(3)	includes: " + c527
a.indexOf(3)	indexOf: " + c528
a.at(0)	at: " + c529
[...a]	spread: " + c530
[...a.entries()]	entries: " + c531`,
        (n, a, b) => `function c${n + 515}(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c532	.push("t")	push text: " + c533
.push(undefined)	push undefined: " + c534	.push(7.5, 7.5)	pushTwo double: " + c535
.push("t", "t")	pushTwo text: " + c536	.push(undefined, undefined)	pushTwo undefined: " + c537
.unshift(7.5)	unshift double: " + c538	.unshift("t")	unshift text: " + c539
.unshift(undefined)	unshift undefined: " + c540	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c541
.splice(1, 0, "t", "t")	spliceIn text: " + c542	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c543
.splice(0, 1, 7.5)	spliceOver double: " + c544	.splice(0, 1, "t")	spliceOver text: " + c545
.splice(0, 1, undefined)	spliceOver undefined: " + c546	.fill(7.5)	fill double: " + c547
.fill("t")	fill text: " + c548	.fill(undefined)	fill undefined: " + c549
.fill(7.5, 1, 2)	fillPart double: " + c550	.fill("t", 1, 2)	fillPart text: " + c551
.fill(undefined, 1, 2)	fillPart undefined: " + c552	[1] = 7.5	store double: " + c553
[1] = "t"	store text: " + c554	[1] = undefined	store undefined: " + c555
[a.length] = 7.5	storeAtEnd double: " + c556	[a.length] = "t"	storeAtEnd text: " + c557
[a.length] = undefined	storeAtEnd undefined: " + c558	.with(0, 7.5)	with double: " + c559
.with(0, "t")	with text: " + c560	.with(0, undefined)	with undefined: " + c561
.concat([7.5])	concat double: " + c562	.concat(["t"])	concat text: " + c563
.concat([undefined])	concat undefined: " + c564	.toSpliced(0, 0, 7.5)	toSpliced double: " + c565
.toSpliced(0, 0, "t")	toSpliced text: " + c566	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c567`,
        (n, a, b, c, d) => `function c${2 * n + 532}(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve ${b}());
function c${2 * n + 533}(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c568
unshift(7.5	unshiftMany double: " + c569
push("t"	pushMany text: " + c570
unshift("t"	unshiftMany text: " + c571
push(undefined	pushMany undefined: " + c572
unshift(undefined	unshiftMany undefined: " + c573`,
        (n, a, b) => `function c${n + 568}(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("empty twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c574
a.shift()	shift: " + c575
a.reverse()	reverse: " + c576
a.sort()	sort: " + c577
a.copyWithin(0, 1)	copyWithin: " + c578
a.splice(0, 2)	spliceOut: " + c579
a.length = 0	lengthZero: " + c580
a.slice(1)	slice: " + c581
a.map((x: unknown) => x)	map: " + c582
a.filter(() => true)	filter: " + c583
a.flat()	flat: " + c584
a.join()	join: " + c585
a.includes(3)	includes: " + c586
a.indexOf(3)	indexOf: " + c587
a.at(0)	at: " + c588
[...a]	spread: " + c589
[...a.entries()]	entries: " + c590`,
        (n, a, b) => `function c${n + 574}(): string {
    const given: any[] = [];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("empty twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c591	.push("t")	push text: " + c592
.push(undefined)	push undefined: " + c593	.push(7.5, 7.5)	pushTwo double: " + c594
.push("t", "t")	pushTwo text: " + c595	.push(undefined, undefined)	pushTwo undefined: " + c596
.unshift(7.5)	unshift double: " + c597	.unshift("t")	unshift text: " + c598
.unshift(undefined)	unshift undefined: " + c599	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c600
.splice(1, 0, "t", "t")	spliceIn text: " + c601	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c602
.splice(0, 1, 7.5)	spliceOver double: " + c603	.splice(0, 1, "t")	spliceOver text: " + c604
.splice(0, 1, undefined)	spliceOver undefined: " + c605	.fill(7.5)	fill double: " + c606
.fill("t")	fill text: " + c607	.fill(undefined)	fill undefined: " + c608
.fill(7.5, 1, 2)	fillPart double: " + c609	.fill("t", 1, 2)	fillPart text: " + c610
.fill(undefined, 1, 2)	fillPart undefined: " + c611	[1] = 7.5	store double: " + c612
[1] = "t"	store text: " + c613	[1] = undefined	store undefined: " + c614
[a.length] = 7.5	storeAtEnd double: " + c615	[a.length] = "t"	storeAtEnd text: " + c616
[a.length] = undefined	storeAtEnd undefined: " + c617	.with(0, 7.5)	with double: " + c618
.with(0, "t")	with text: " + c619	.with(0, undefined)	with undefined: " + c620
.concat([7.5])	concat double: " + c621	.concat(["t"])	concat text: " + c622
.concat([undefined])	concat undefined: " + c623	.toSpliced(0, 0, 7.5)	toSpliced double: " + c624
.toSpliced(0, 0, "t")	toSpliced text: " + c625	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c626`,
        (n, a, b, c, d) => `function c${2 * n + 591}(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one ${b}());
function c${2 * n + 592}(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c627
unshift(7.5	unshiftMany double: " + c628
push("t"	pushMany text: " + c629
unshift("t"	unshiftMany text: " + c630
push(undefined	pushMany undefined: " + c631
unshift(undefined	unshiftMany undefined: " + c632`,
        (n, a, b) => `function c${n + 627}(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c633
a.shift()	shift: " + c634
a.reverse()	reverse: " + c635
a.sort()	sort: " + c636
a.copyWithin(0, 1)	copyWithin: " + c637
a.splice(0, 2)	spliceOut: " + c638
a.length = 0	lengthZero: " + c639
a.slice(1)	slice: " + c640
a.map((x: unknown) => x)	map: " + c641
a.filter(() => true)	filter: " + c642
a.flat()	flat: " + c643
a.join()	join: " + c644
a.includes(3)	includes: " + c645
a.indexOf(3)	indexOf: " + c646
a.at(0)	at: " + c647
[...a]	spread: " + c648
[...a.entries()]	entries: " + c649`,
        (n, a, b) => `function c${n + 633}(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c650	.push("t")	push text: " + c651
.push(undefined)	push undefined: " + c652	.push(7.5, 7.5)	pushTwo double: " + c653
.push("t", "t")	pushTwo text: " + c654	.push(undefined, undefined)	pushTwo undefined: " + c655
.unshift(7.5)	unshift double: " + c656	.unshift("t")	unshift text: " + c657
.unshift(undefined)	unshift undefined: " + c658	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c659
.splice(1, 0, "t", "t")	spliceIn text: " + c660	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c661
.splice(0, 1, 7.5)	spliceOver double: " + c662	.splice(0, 1, "t")	spliceOver text: " + c663
.splice(0, 1, undefined)	spliceOver undefined: " + c664	.fill(7.5)	fill double: " + c665
.fill("t")	fill text: " + c666	.fill(undefined)	fill undefined: " + c667
.fill(7.5, 1, 2)	fillPart double: " + c668	.fill("t", 1, 2)	fillPart text: " + c669
.fill(undefined, 1, 2)	fillPart undefined: " + c670	[1] = 7.5	store double: " + c671
[1] = "t"	store text: " + c672	[1] = undefined	store undefined: " + c673
[a.length] = 7.5	storeAtEnd double: " + c674	[a.length] = "t"	storeAtEnd text: " + c675
[a.length] = undefined	storeAtEnd undefined: " + c676	.with(0, 7.5)	with double: " + c677
.with(0, "t")	with text: " + c678	.with(0, undefined)	with undefined: " + c679
.concat([7.5])	concat double: " + c680	.concat(["t"])	concat text: " + c681
.concat([undefined])	concat undefined: " + c682	.toSpliced(0, 0, 7.5)	toSpliced double: " + c683
.toSpliced(0, 0, "t")	toSpliced text: " + c684	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c685`,
        (n, a, b, c, d) => `function c${2 * n + 650}(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve ${b}());
function c${2 * n + 651}(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c686
unshift(7.5	unshiftMany double: " + c687
push("t"	pushMany text: " + c688
unshift("t"	unshiftMany text: " + c689
push(undefined	pushMany undefined: " + c690
unshift(undefined	unshiftMany undefined: " + c691`,
        (n, a, b) => `function c${n + 686}(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("holes twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c692
a.shift()	shift: " + c693
a.reverse()	reverse: " + c694
a.sort()	sort: " + c695
a.copyWithin(0, 1)	copyWithin: " + c696
a.splice(0, 2)	spliceOut: " + c697
a.length = 0	lengthZero: " + c698
a.slice(1)	slice: " + c699
a.map((x: unknown) => x)	map: " + c700
a.filter(() => true)	filter: " + c701
a.flat()	flat: " + c702
a.join()	join: " + c703
a.includes(3)	includes: " + c704
a.indexOf(3)	indexOf: " + c705
a.at(0)	at: " + c706
[...a]	spread: " + c707
[...a.entries()]	entries: " + c708`,
        (n, a, b) => `function c${n + 692}(): string {
    const given: any[] = [1, , 3];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("holes twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c709	.push("t")	push text: " + c710
.push(undefined)	push undefined: " + c711	.push(7.5, 7.5)	pushTwo double: " + c712
.push("t", "t")	pushTwo text: " + c713	.push(undefined, undefined)	pushTwo undefined: " + c714
.unshift(7.5)	unshift double: " + c715	.unshift("t")	unshift text: " + c716
.unshift(undefined)	unshift undefined: " + c717	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c718
.splice(1, 0, "t", "t")	spliceIn text: " + c719	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c720
.splice(0, 1, 7.5)	spliceOver double: " + c721	.splice(0, 1, "t")	spliceOver text: " + c722
.splice(0, 1, undefined)	spliceOver undefined: " + c723	.fill(7.5)	fill double: " + c724
.fill("t")	fill text: " + c725	.fill(undefined)	fill undefined: " + c726
.fill(7.5, 1, 2)	fillPart double: " + c727	.fill("t", 1, 2)	fillPart text: " + c728
.fill(undefined, 1, 2)	fillPart undefined: " + c729	[1] = 7.5	store double: " + c730
[1] = "t"	store text: " + c731	[1] = undefined	store undefined: " + c732
[a.length] = 7.5	storeAtEnd double: " + c733	[a.length] = "t"	storeAtEnd text: " + c734
[a.length] = undefined	storeAtEnd undefined: " + c735	.with(0, 7.5)	with double: " + c736
.with(0, "t")	with text: " + c737	.with(0, undefined)	with undefined: " + c738
.concat([7.5])	concat double: " + c739	.concat(["t"])	concat text: " + c740
.concat([undefined])	concat undefined: " + c741	.toSpliced(0, 0, 7.5)	toSpliced double: " + c742
.toSpliced(0, 0, "t")	toSpliced text: " + c743	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c744`,
        (n, a, b, c, d) => `function c${2 * n + 709}(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one ${b}());
function c${2 * n + 710}(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c745
unshift(7.5	unshiftMany double: " + c746
push("t"	pushMany text: " + c747
unshift("t"	unshiftMany text: " + c748
push(undefined	pushMany undefined: " + c749
unshift(undefined	unshiftMany undefined: " + c750`,
        (n, a, b) => `function c${n + 745}(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c751
a.shift()	shift: " + c752
a.reverse()	reverse: " + c753
a.sort()	sort: " + c754
a.copyWithin(0, 1)	copyWithin: " + c755
a.splice(0, 2)	spliceOut: " + c756
a.length = 0	lengthZero: " + c757
a.slice(1)	slice: " + c758
a.map((x: unknown) => x)	map: " + c759
a.filter(() => true)	filter: " + c760
a.flat()	flat: " + c761
a.join()	join: " + c762
a.includes(3)	includes: " + c763
a.indexOf(3)	indexOf: " + c764
a.at(0)	at: " + c765
[...a]	spread: " + c766
[...a.entries()]	entries: " + c767`,
        (n, a, b) => `function c${n + 751}(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c768	.push("t")	push text: " + c769
.push(undefined)	push undefined: " + c770	.push(7.5, 7.5)	pushTwo double: " + c771
.push("t", "t")	pushTwo text: " + c772	.push(undefined, undefined)	pushTwo undefined: " + c773
.unshift(7.5)	unshift double: " + c774	.unshift("t")	unshift text: " + c775
.unshift(undefined)	unshift undefined: " + c776	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c777
.splice(1, 0, "t", "t")	spliceIn text: " + c778	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c779
.splice(0, 1, 7.5)	spliceOver double: " + c780	.splice(0, 1, "t")	spliceOver text: " + c781
.splice(0, 1, undefined)	spliceOver undefined: " + c782	.fill(7.5)	fill double: " + c783
.fill("t")	fill text: " + c784	.fill(undefined)	fill undefined: " + c785
.fill(7.5, 1, 2)	fillPart double: " + c786	.fill("t", 1, 2)	fillPart text: " + c787
.fill(undefined, 1, 2)	fillPart undefined: " + c788	[1] = 7.5	store double: " + c789
[1] = "t"	store text: " + c790	[1] = undefined	store undefined: " + c791
[a.length] = 7.5	storeAtEnd double: " + c792	[a.length] = "t"	storeAtEnd text: " + c793
[a.length] = undefined	storeAtEnd undefined: " + c794	.with(0, 7.5)	with double: " + c795
.with(0, "t")	with text: " + c796	.with(0, undefined)	with undefined: " + c797
.concat([7.5])	concat double: " + c798	.concat(["t"])	concat text: " + c799
.concat([undefined])	concat undefined: " + c800	.toSpliced(0, 0, 7.5)	toSpliced double: " + c801
.toSpliced(0, 0, "t")	toSpliced text: " + c802	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c803`,
        (n, a, b, c, d) => `function c${2 * n + 768}(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve ${b}());
function c${2 * n + 769}(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c804
unshift(7.5	unshiftMany double: " + c805
push("t"	pushMany text: " + c806
unshift("t"	unshiftMany text: " + c807
push(undefined	pushMany undefined: " + c808
unshift(undefined	unshiftMany undefined: " + c809`,
        (n, a, b) => `function c${n + 804}(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c810
a.shift()	shift: " + c811
a.reverse()	reverse: " + c812
a.sort()	sort: " + c813
a.copyWithin(0, 1)	copyWithin: " + c814
a.splice(0, 2)	spliceOut: " + c815
a.length = 0	lengthZero: " + c816
a.slice(1)	slice: " + c817
a.map((x: unknown) => x)	map: " + c818
a.filter(() => true)	filter: " + c819
a.flat()	flat: " + c820
a.join()	join: " + c821
a.includes(3)	includes: " + c822
a.indexOf(3)	indexOf: " + c823
a.at(0)	at: " + c824
[...a]	spread: " + c825
[...a.entries()]	entries: " + c826`,
        (n, a, b) => `function c${n + 810}(): string {
    const given: any[] = [1.5, , 3.5];
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("doubleHoles twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c827	.push("t")	push text: " + c828
.push(undefined)	push undefined: " + c829	.push(7.5, 7.5)	pushTwo double: " + c830
.push("t", "t")	pushTwo text: " + c831	.push(undefined, undefined)	pushTwo undefined: " + c832
.unshift(7.5)	unshift double: " + c833	.unshift("t")	unshift text: " + c834
.unshift(undefined)	unshift undefined: " + c835	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c836
.splice(1, 0, "t", "t")	spliceIn text: " + c837	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c838
.splice(0, 1, 7.5)	spliceOver double: " + c839	.splice(0, 1, "t")	spliceOver text: " + c840
.splice(0, 1, undefined)	spliceOver undefined: " + c841	.fill(7.5)	fill double: " + c842
.fill("t")	fill text: " + c843	.fill(undefined)	fill undefined: " + c844
.fill(7.5, 1, 2)	fillPart double: " + c845	.fill("t", 1, 2)	fillPart text: " + c846
.fill(undefined, 1, 2)	fillPart undefined: " + c847	[1] = 7.5	store double: " + c848
[1] = "t"	store text: " + c849	[1] = undefined	store undefined: " + c850
[a.length] = 7.5	storeAtEnd double: " + c851	[a.length] = "t"	storeAtEnd text: " + c852
[a.length] = undefined	storeAtEnd undefined: " + c853	.with(0, 7.5)	with double: " + c854
.with(0, "t")	with text: " + c855	.with(0, undefined)	with undefined: " + c856
.concat([7.5])	concat double: " + c857	.concat(["t"])	concat text: " + c858
.concat([undefined])	concat undefined: " + c859	.toSpliced(0, 0, 7.5)	toSpliced double: " + c860
.toSpliced(0, 0, "t")	toSpliced text: " + c861	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c862`,
        (n, a, b, c, d) => `function c${2 * n + 827}(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one ${b}());
function c${2 * n + 828}(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c863
unshift(7.5	unshiftMany double: " + c864
push("t"	pushMany text: " + c865
unshift("t"	unshiftMany text: " + c866
push(undefined	pushMany undefined: " + c867
unshift(undefined	unshiftMany undefined: " + c868`,
        (n, a, b) => `function c${n + 863}(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c869
a.shift()	shift: " + c870
a.reverse()	reverse: " + c871
a.sort()	sort: " + c872
a.copyWithin(0, 1)	copyWithin: " + c873
a.splice(0, 2)	spliceOut: " + c874
a.length = 0	lengthZero: " + c875
a.slice(1)	slice: " + c876
a.map((x: unknown) => x)	map: " + c877
a.filter(() => true)	filter: " + c878
a.flat()	flat: " + c879
a.join()	join: " + c880
a.includes(3)	includes: " + c881
a.indexOf(3)	indexOf: " + c882
a.at(0)	at: " + c883
[...a]	spread: " + c884
[...a.entries()]	entries: " + c885`,
        (n, a, b) => `function c${n + 869}(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c886	.push("t")	push text: " + c887
.push(undefined)	push undefined: " + c888	.push(7.5, 7.5)	pushTwo double: " + c889
.push("t", "t")	pushTwo text: " + c890	.push(undefined, undefined)	pushTwo undefined: " + c891
.unshift(7.5)	unshift double: " + c892	.unshift("t")	unshift text: " + c893
.unshift(undefined)	unshift undefined: " + c894	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c895
.splice(1, 0, "t", "t")	spliceIn text: " + c896	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c897
.splice(0, 1, 7.5)	spliceOver double: " + c898	.splice(0, 1, "t")	spliceOver text: " + c899
.splice(0, 1, undefined)	spliceOver undefined: " + c900	.fill(7.5)	fill double: " + c901
.fill("t")	fill text: " + c902	.fill(undefined)	fill undefined: " + c903
.fill(7.5, 1, 2)	fillPart double: " + c904	.fill("t", 1, 2)	fillPart text: " + c905
.fill(undefined, 1, 2)	fillPart undefined: " + c906	[1] = 7.5	store double: " + c907
[1] = "t"	store text: " + c908	[1] = undefined	store undefined: " + c909
[a.length] = 7.5	storeAtEnd double: " + c910	[a.length] = "t"	storeAtEnd text: " + c911
[a.length] = undefined	storeAtEnd undefined: " + c912	.with(0, 7.5)	with double: " + c913
.with(0, "t")	with text: " + c914	.with(0, undefined)	with undefined: " + c915
.concat([7.5])	concat double: " + c916	.concat(["t"])	concat text: " + c917
.concat([undefined])	concat undefined: " + c918	.toSpliced(0, 0, 7.5)	toSpliced double: " + c919
.toSpliced(0, 0, "t")	toSpliced text: " + c920	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c921`,
        (n, a, b, c, d) => `function c${2 * n + 886}(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve ${b}());
function c${2 * n + 887}(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c922
unshift(7.5	unshiftMany double: " + c923
push("t"	pushMany text: " + c924
unshift("t"	unshiftMany text: " + c925
push(undefined	pushMany undefined: " + c926
unshift(undefined	unshiftMany undefined: " + c927`,
        (n, a, b) => `function c${n + 922}(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("long twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c928
a.shift()	shift: " + c929
a.reverse()	reverse: " + c930
a.sort()	sort: " + c931
a.copyWithin(0, 1)	copyWithin: " + c932
a.splice(0, 2)	spliceOut: " + c933
a.length = 0	lengthZero: " + c934
a.slice(1)	slice: " + c935
a.map((x: unknown) => x)	map: " + c936
a.filter(() => true)	filter: " + c937
a.flat()	flat: " + c938
a.join()	join: " + c939
a.includes(3)	includes: " + c940
a.indexOf(3)	indexOf: " + c941
a.at(0)	at: " + c942
[...a]	spread: " + c943
[...a.entries()]	entries: " + c944`,
        (n, a, b) => `function c${n + 928}(): string {
    const given: any[] = Array.from({ length: 40 }, (_, i) => i);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("long twelve ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c945	.push("t")	push text: " + c946
.push(undefined)	push undefined: " + c947	.push(7.5, 7.5)	pushTwo double: " + c948
.push("t", "t")	pushTwo text: " + c949	.push(undefined, undefined)	pushTwo undefined: " + c950
.unshift(7.5)	unshift double: " + c951	.unshift("t")	unshift text: " + c952
.unshift(undefined)	unshift undefined: " + c953	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c954
.splice(1, 0, "t", "t")	spliceIn text: " + c955	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c956
.splice(0, 1, 7.5)	spliceOver double: " + c957	.splice(0, 1, "t")	spliceOver text: " + c958
.splice(0, 1, undefined)	spliceOver undefined: " + c959	.fill(7.5)	fill double: " + c960
.fill("t")	fill text: " + c961	.fill(undefined)	fill undefined: " + c962
.fill(7.5, 1, 2)	fillPart double: " + c963	.fill("t", 1, 2)	fillPart text: " + c964
.fill(undefined, 1, 2)	fillPart undefined: " + c965	[1] = 7.5	store double: " + c966
[1] = "t"	store text: " + c967	[1] = undefined	store undefined: " + c968
[a.length] = 7.5	storeAtEnd double: " + c969	[a.length] = "t"	storeAtEnd text: " + c970
[a.length] = undefined	storeAtEnd undefined: " + c971	.with(0, 7.5)	with double: " + c972
.with(0, "t")	with text: " + c973	.with(0, undefined)	with undefined: " + c974
.concat([7.5])	concat double: " + c975	.concat(["t"])	concat text: " + c976
.concat([undefined])	concat undefined: " + c977	.toSpliced(0, 0, 7.5)	toSpliced double: " + c978
.toSpliced(0, 0, "t")	toSpliced text: " + c979	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c980`,
        (n, a, b, c, d) => `function c${2 * n + 945}(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one ${b}());
function c${2 * n + 946}(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c981
unshift(7.5	unshiftMany double: " + c982
push("t"	pushMany text: " + c983
unshift("t"	unshiftMany text: " + c984
push(undefined	pushMany undefined: " + c985
unshift(undefined	unshiftMany undefined: " + c986`,
        (n, a, b) => `function c${n + 981}(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength one ${b}());`,
      ],
      [
        `a.pop()	pop: " + c987
a.shift()	shift: " + c988
a.reverse()	reverse: " + c989
a.sort()	sort: " + c990
a.copyWithin(0, 1)	copyWithin: " + c991
a.splice(0, 2)	spliceOut: " + c992
a.length = 0	lengthZero: " + c993
a.slice(1)	slice: " + c994
a.map((x: unknown) => x)	map: " + c995
a.filter(() => true)	filter: " + c996
a.flat()	flat: " + c997
a.join()	join: " + c998
a.includes(3)	includes: " + c999
a.indexOf(3)	indexOf: " + c1000
a.at(0)	at: " + c1001
[...a]	spread: " + c1002
[...a.entries()]	entries: " + c1003`,
        (n, a, b) => `function c${n + 987}(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    (a as any).extra = "kept";
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength one ${b}());`,
      ],
      [
        `.push(7.5)	push double: " + c1004	.push("t")	push text: " + c1005
.push(undefined)	push undefined: " + c1006	.push(7.5, 7.5)	pushTwo double: " + c1007
.push("t", "t")	pushTwo text: " + c1008	.push(undefined, undefined)	pushTwo undefined: " + c1009
.unshift(7.5)	unshift double: " + c1010	.unshift("t")	unshift text: " + c1011
.unshift(undefined)	unshift undefined: " + c1012	.splice(1, 0, 7.5, 7.5)	spliceIn double: " + c1013
.splice(1, 0, "t", "t")	spliceIn text: " + c1014	.splice(1, 0, undefined, undefined)	spliceIn undefined: " + c1015
.splice(0, 1, 7.5)	spliceOver double: " + c1016	.splice(0, 1, "t")	spliceOver text: " + c1017
.splice(0, 1, undefined)	spliceOver undefined: " + c1018	.fill(7.5)	fill double: " + c1019
.fill("t")	fill text: " + c1020	.fill(undefined)	fill undefined: " + c1021
.fill(7.5, 1, 2)	fillPart double: " + c1022	.fill("t", 1, 2)	fillPart text: " + c1023
.fill(undefined, 1, 2)	fillPart undefined: " + c1024	[1] = 7.5	store double: " + c1025
[1] = "t"	store text: " + c1026	[1] = undefined	store undefined: " + c1027
[a.length] = 7.5	storeAtEnd double: " + c1028	[a.length] = "t"	storeAtEnd text: " + c1029
[a.length] = undefined	storeAtEnd undefined: " + c1030	.with(0, 7.5)	with double: " + c1031
.with(0, "t")	with text: " + c1032	.with(0, undefined)	with undefined: " + c1033
.concat([7.5])	concat double: " + c1034	.concat(["t"])	concat text: " + c1035
.concat([undefined])	concat undefined: " + c1036	.toSpliced(0, 0, 7.5)	toSpliced double: " + c1037
.toSpliced(0, 0, "t")	toSpliced text: " + c1038	.toSpliced(0, 0, undefined)	toSpliced undefined: " + c1039`,
        (n, a, b, c, d) => `function c${2 * n + 1004}(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve ${b}());
function c${2 * n + 1005}(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = a${c}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve ${d}());`,
      ],
      [
        `push(7.5	pushMany double: " + c1040
unshift(7.5	unshiftMany double: " + c1041
push("t"	pushMany text: " + c1042
unshift("t"	unshiftMany text: " + c1043
push(undefined	pushMany undefined: " + c1044
unshift(undefined	unshiftMany undefined: " + c1045`,
        (n, a, b) => `function c${n + 1040}(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { for (let i = 0; i < 70; i++) { r = a.${a}); if (i % 16 === 0) churn(); } } catch (e) { r = thrown(e); }
    return show(r) + " " + show(a);
}
lines.push("withLength twelve ${b}());`,
      ],
      [
        `a.pop()	pop: " + c1046
a.shift()	shift: " + c1047
a.reverse()	reverse: " + c1048
a.sort()	sort: " + c1049
a.copyWithin(0, 1)	copyWithin: " + c1050
a.splice(0, 2)	spliceOut: " + c1051
a.length = 0	lengthZero: " + c1052
a.slice(1)	slice: " + c1053
a.map((x: unknown) => x)	map: " + c1054
a.filter(() => true)	filter: " + c1055
a.flat()	flat: " + c1056
a.join()	join: " + c1057
a.includes(3)	includes: " + c1058
a.indexOf(3)	indexOf: " + c1059
a.at(0)	at: " + c1060
[...a]	spread: " + c1061
[...a.entries()]	entries: " + c1062`,
        (n, a, b) => `function c${n + 1046}(): string {
    const given: any[] = new Array(5);
    const a: any[] = holder(given);
    for (let k = 0; k < 12; k++) (a as any)["name" + k] = k * 2;
    let r: unknown;
    try { r = ${a}; } catch (e) { r = thrown(e); }
    churn();
    return show(r) + " " + show(a);
}
lines.push("withLength twelve ${b}());`,
      ],
      `console.log(lines.join("\\n"));
`,
    ),
    ...untypedTwins("arrays", "js", ["sort-comparator-mutates-array"]),
  });
