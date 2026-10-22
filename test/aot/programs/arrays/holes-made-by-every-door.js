// Every way to make a hole in an array, and the operations that must not count as one. Each case has its own literal and its own readers: a proof that an array has no holes is about all arrays of a site.
const pick = Date.now() > 0;
function deleteSecond(list) { delete list[1]; }
function lengthen(list) { list.length = list.length + 2; }
function same(list) { return list; }
const lines = [];
function run(name, f) { try { lines.push(name + ": " + f()); } catch (error) { lines.push(name + ": threw " + error.name); } }
function f1() {
  const a = [1, 2, 3, 4];
  a.length = a.length + 1;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | length plus one", f1);
function f2() {
  const a = [1, 2, 3, 4];
  a.length++;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | length increment", f2);
function f3() {
  const a = [1, 2, 3, 4];
  a.length += 2;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | length plus two", f3);
function f4() {
  const a = [1, 2, 3, 4];
  a.length = "6";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | length from text", f4);
function f5() {
  const a = [1, 2, 3, 4];
  a.length = { valueOf() { return 6; } };
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | length from object", f5);
function f6() {
  const a = [1, 2, 3, 4];
  a.length = 0; a[1] = 7;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | emptied, stored at one", f6);
function f7() {
  const a = [1, 2, 3, 4];
  a.length = 0; a.push(7); a.push(7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | emptied, pushed", f7);
function f8() {
  const a = [1, 2, 3, 4];
  a.length = 1; a.length = 3;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | shorter, longer", f8);
function f9() {
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
  Object.defineProperty(a, "length", { value: 6 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | define length", f19);
function f20() {
  const a = [1, 2, 3, 4];
  Reflect.set(a, 6, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | reflect set", f20);
function f21() {
  const a = [1, 2, 3, 4];
  Reflect.set(a, "length", 6);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | reflect set length", f21);
function f22() {
  const a = [1, 2, 3, 4];
  Reflect.deleteProperty(a, 1);
  let s = "";
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
  a.push(7); a.pop(); a.shift(); a.unshift(7, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | push, pop, shift, unshift", f35);
function f36() {
  const a = [1, 2, 3, 4];
  a.splice(1, 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | splice out", f36);
function f37() {
  const a = [1, 2, 3, 4];
  a.splice(1, 0, 7, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | splice in", f37);
function f38() {
  const a = [1, 2, 3, 4];
  a.splice(10, 0, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | splice beyond", f38);
function f39() {
  const a = [1, 2, 3, 4];
  a.splice(1, 0, ...[1, , 3, 4]);
  let s = "";
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
  const o = { get list() { return a; } }; delete o.list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | with a getter", f62);
function f63() {
  const a = pick ? [1, 2, 3, 4] : Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | literal or Array(n)", f63);
function f64() {
  const a = pick ? [1, 2, 3, 4] : new Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | literal or new Array(n)", f64);
function f65() {
  const a = !pick ? [1, 2, 3, 4] : new Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | Array(n) or literal", f65);
function f66() {
  const a = new Array(7, 7, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | new Array of items", f66);
function f67() {
  const a = Array.of(7, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | Array.of", f67);
function f68() {
  const a = [1, 2, 3, 4].concat([1, , 3, 4]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | concat holes", f68);
function f69() {
  const a = [1, , 3, 4].concat([1, 2, 3, 4]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes concat", f69);
function f70() {
  const a = [1, 2, 3, 4].concat([1, 2, 3, 4], 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | concat whole", f70);
function f71() {
  const a = [1, 2, 3, 4].concat({ length: 3, 0: 7, [Symbol.isConcatSpreadable]: true });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | concat array-like", f71);
function f72() {
  const a = [...[1, , 3, 4]];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | spread holes", f72);
function f73() {
  const a = [...[1, 2, 3, 4], 7];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | spread whole", f73);
function f74() {
  const a = Array.from({ length: 3 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | from length", f74);
function f75() {
  const a = Array.from([1, , 3, 4]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | from holes", f75);
function f76() {
  const a = [1, , 3, 4].slice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | slice holes", f76);
function f77() {
  const a = [1, 2, 3, 4].slice(1);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | slice whole", f77);
function f78() {
  const a = [1, , 3, 4].splice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | splice result holes", f78);
function f79() {
  const a = [1, 2, 3, 4].splice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | splice result whole", f79);
function f80() {
  const a = [1, , 3, 4].fill(7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes filled", f80);
function f81() {
  const a = [1, , 3, 4].fill(7, 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes part filled", f81);
function f82() {
  const a = [1, , 3, 4].copyWithin(2, 0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes copyWithin", f82);
function f83() {
  const a = [1, , 3, 4].sort();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes sorted", f83);
function f84() {
  const a = [1, , 3, 4].reverse();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes reversed", f84);
function f85() {
  const a = [1, , 3, 4].toReversed();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes toReversed", f85);
function f86() {
  const a = [1, , 3, 4].toSorted();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes toSorted", f86);
function f87() {
  const a = [1, , 3, 4].toSpliced(0, 1);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes toSpliced", f87);
function f88() {
  const a = [1, , 3, 4].with(0, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes with", f88);
function f89() {
  const a = [1, , 3, 4].flat();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | holes flat", f89);
function f90() {
  const a = Object.keys({ p: 1, q: 2, r: 3 }); delete a[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | keys then delete", f90);
function f91() {
  const a = Object.keys({ p: 1, q: 2, r: 3 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | keys", f91);
function f92() {
  const a = Object.values({ p: 7, q: 7 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | values", f92);
function f93() {
  const a = "p,q,,r".split(",");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | split", f93);
function f94() {
  const a = "p,q".split(","); a.length = 4;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | split then longer", f94);
function f95() {
  const a = JSON.parse("[1, 2, 3]");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | parsed", f95);
function f96() {
  const a = JSON.parse("[1, 2, 3]", (k, v) => (v === 2 ? undefined : v));
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | parsed and revived", f96);
function f97() {
  const a = ((...rest) => rest)(7, 7, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | rest", f97);
function f98() {
  const a = ((...rest) => rest)(7, 7, 7); delete a[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | rest then delete", f98);
function f99() {
  const a = new Array(...[3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | new Array of spread length", f99);
function f100() {
  const a = Array(...[3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | Array of spread length", f100);
function f101() {
  const a = Array.apply(null, [3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | Array applied", f101);
function f102() {
  const a = Reflect.construct(Array, [3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | Array constructed", f102);
function f103() {
  const a = new Array(pick ? 3 : 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | new Array of number or item", f103);
function f104() {
  const a = new Array(pick ? 7 : 3);
  let s = "";
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
  class Rows extends Array {} const a = new Rows(7, 7);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | subclass of items", f106);
function f107() {
  const a = [7, 7, , ];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | literal with elision at end", f107);
function f108() {
  const a = [...[1, 2, 3, 4], , 7];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | spread then elision", f108);
function f109() {
  const a = [1, , 3, 4].slice(0).slice(0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | slice of slice of holes", f109);
function f110() {
  const a = [1, 2, 3, 4].concat([1, 2, 3, 4].concat([1, , 3, 4]));
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | concat of concat of holes", f110);
function f111() {
  const a = (pick ? [1, , 3, 4] : [1, 2, 3, 4]).slice(0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | slice of either", f111);
function f112() {
  const a = Object.entries({ p: 7, q: 7 })[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | entries", f112);
function f113() {
  const a = Reflect.ownKeys({ p: 1, q: 2 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | own keys", f113);
function f114() {
  const a = Object.getOwnPropertyNames({ p: 1, q: 2 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | names", f114);
function f115() {
  const a = "p1q22r".split(/\d/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | split by pattern", f115);
function f116() {
  const a = "p1q".split(/(\d)|(x)/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | split with groups", f116);
function f117() {
  const a = "p1q".match(/(\d)|(x)/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | match", f117);
function f118() {
  const a = [1, 2, 3, 4].with(0, 7); delete a[2];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | with then delete", f118);
function f119() {
  const a = [1, 2, 3, 4].toSpliced(0, 1); a.length = 5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("ints | toSpliced then longer", f119);
function f120() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length = a.length + 1;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | length plus one", f120);
function f121() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length++;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | length increment", f121);
function f122() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length += 2;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | length plus two", f122);
function f123() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length = "6";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | length from text", f123);
function f124() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length = { valueOf() { return 6; } };
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | length from object", f124);
function f125() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length = 0; a[1] = 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | emptied, stored at one", f125);
function f126() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length = 0; a.push(7.5); a.push(7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | emptied, pushed", f126);
function f127() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.length = 1; a.length = 3;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | shorter, longer", f127);
function f128() {
  const a = [1.5, 2.5, 3.5, 4.5];
  delete a[0];
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
  for (let k = 0; k < a.length; k += 2) delete a[k];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | delete by variable", f130);
function f131() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a[a.length + 1] = 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | store above length", f131);
function f132() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a[a.length] = 7.5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | store at length", f132);
function f133() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a[40] = 7.5;
  let s = "";
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
  Object.defineProperty(a, "length", { value: 6 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | define length", f138);
function f139() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Reflect.set(a, 6, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | reflect set", f139);
function f140() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Reflect.set(a, "length", 6);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | reflect set length", f140);
function f141() {
  const a = [1.5, 2.5, 3.5, 4.5];
  Reflect.deleteProperty(a, 1);
  let s = "";
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
  Array.prototype.pop.call(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | pop call", f153);
function f154() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.push(7.5); a.pop(); a.shift(); a.unshift(7.5, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | push, pop, shift, unshift", f154);
function f155() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.splice(1, 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | splice out", f155);
function f156() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.splice(1, 0, 7.5, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | splice in", f156);
function f157() {
  const a = [1.5, 2.5, 3.5, 4.5];
  a.splice(10, 0, 7.5);
  let s = "";
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
  const o = { get list() { return a; } }; delete o.list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | with a getter", f181);
function f182() {
  const a = pick ? [1.5, 2.5, 3.5, 4.5] : Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | literal or Array(n)", f182);
function f183() {
  const a = pick ? [1.5, 2.5, 3.5, 4.5] : new Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | literal or new Array(n)", f183);
function f184() {
  const a = !pick ? [1.5, 2.5, 3.5, 4.5] : new Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | Array(n) or literal", f184);
function f185() {
  const a = new Array(7.5, 7.5, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | new Array of items", f185);
function f186() {
  const a = Array.of(7.5, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | Array.of", f186);
function f187() {
  const a = [1.5, 2.5, 3.5, 4.5].concat([1.5, , 3.5, 4.5]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | concat holes", f187);
function f188() {
  const a = [1.5, , 3.5, 4.5].concat([1.5, 2.5, 3.5, 4.5]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes concat", f188);
function f189() {
  const a = [1.5, 2.5, 3.5, 4.5].concat([1.5, 2.5, 3.5, 4.5], 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | concat whole", f189);
function f190() {
  const a = [1.5, 2.5, 3.5, 4.5].concat({ length: 3, 0: 7.5, [Symbol.isConcatSpreadable]: true });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | concat array-like", f190);
function f191() {
  const a = [...[1.5, , 3.5, 4.5]];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | spread holes", f191);
function f192() {
  const a = [...[1.5, 2.5, 3.5, 4.5], 7.5];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | spread whole", f192);
function f193() {
  const a = Array.from({ length: 3 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | from length", f193);
function f194() {
  const a = Array.from([1.5, , 3.5, 4.5]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | from holes", f194);
function f195() {
  const a = [1.5, , 3.5, 4.5].slice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | slice holes", f195);
function f196() {
  const a = [1.5, 2.5, 3.5, 4.5].slice(1);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | slice whole", f196);
function f197() {
  const a = [1.5, , 3.5, 4.5].splice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | splice result holes", f197);
function f198() {
  const a = [1.5, 2.5, 3.5, 4.5].splice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | splice result whole", f198);
function f199() {
  const a = [1.5, , 3.5, 4.5].fill(7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes filled", f199);
function f200() {
  const a = [1.5, , 3.5, 4.5].fill(7.5, 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes part filled", f200);
function f201() {
  const a = [1.5, , 3.5, 4.5].copyWithin(2, 0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes copyWithin", f201);
function f202() {
  const a = [1.5, , 3.5, 4.5].sort();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes sorted", f202);
function f203() {
  const a = [1.5, , 3.5, 4.5].reverse();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes reversed", f203);
function f204() {
  const a = [1.5, , 3.5, 4.5].toReversed();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes toReversed", f204);
function f205() {
  const a = [1.5, , 3.5, 4.5].toSorted();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes toSorted", f205);
function f206() {
  const a = [1.5, , 3.5, 4.5].toSpliced(0, 1);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes toSpliced", f206);
function f207() {
  const a = [1.5, , 3.5, 4.5].with(0, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes with", f207);
function f208() {
  const a = [1.5, , 3.5, 4.5].flat();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | holes flat", f208);
function f209() {
  const a = Object.keys({ p: 1, q: 2, r: 3 }); delete a[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | keys then delete", f209);
function f210() {
  const a = Object.keys({ p: 1, q: 2, r: 3 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | keys", f210);
function f211() {
  const a = Object.values({ p: 7.5, q: 7.5 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | values", f211);
function f212() {
  const a = "p,q,,r".split(",");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | split", f212);
function f213() {
  const a = "p,q".split(","); a.length = 4;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | split then longer", f213);
function f214() {
  const a = JSON.parse("[1, 2, 3]");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | parsed", f214);
function f215() {
  const a = JSON.parse("[1, 2, 3]", (k, v) => (v === 2 ? undefined : v));
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | parsed and revived", f215);
function f216() {
  const a = ((...rest) => rest)(7.5, 7.5, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | rest", f216);
function f217() {
  const a = ((...rest) => rest)(7.5, 7.5, 7.5); delete a[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | rest then delete", f217);
function f218() {
  const a = new Array(...[3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | new Array of spread length", f218);
function f219() {
  const a = Array(...[3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | Array of spread length", f219);
function f220() {
  const a = Array.apply(null, [3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | Array applied", f220);
function f221() {
  const a = Reflect.construct(Array, [3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | Array constructed", f221);
function f222() {
  const a = new Array(pick ? 3 : 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | new Array of number or item", f222);
function f223() {
  const a = new Array(pick ? 7.5 : 3);
  let s = "";
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
  class Rows extends Array {} const a = new Rows(7.5, 7.5);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | subclass of items", f225);
function f226() {
  const a = [7.5, 7.5, , ];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | literal with elision at end", f226);
function f227() {
  const a = [...[1.5, 2.5, 3.5, 4.5], , 7.5];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | spread then elision", f227);
function f228() {
  const a = [1.5, , 3.5, 4.5].slice(0).slice(0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | slice of slice of holes", f228);
function f229() {
  const a = [1.5, 2.5, 3.5, 4.5].concat([1.5, 2.5, 3.5, 4.5].concat([1.5, , 3.5, 4.5]));
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | concat of concat of holes", f229);
function f230() {
  const a = (pick ? [1.5, , 3.5, 4.5] : [1.5, 2.5, 3.5, 4.5]).slice(0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | slice of either", f230);
function f231() {
  const a = Object.entries({ p: 7.5, q: 7.5 })[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | entries", f231);
function f232() {
  const a = Reflect.ownKeys({ p: 1, q: 2 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | own keys", f232);
function f233() {
  const a = Object.getOwnPropertyNames({ p: 1, q: 2 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | names", f233);
function f234() {
  const a = "p1q22r".split(/\d/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | split by pattern", f234);
function f235() {
  const a = "p1q".split(/(\d)|(x)/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | split with groups", f235);
function f236() {
  const a = "p1q".match(/(\d)|(x)/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | match", f236);
function f237() {
  const a = [1.5, 2.5, 3.5, 4.5].with(0, 7.5); delete a[2];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | with then delete", f237);
function f238() {
  const a = [1.5, 2.5, 3.5, 4.5].toSpliced(0, 1); a.length = 5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("fractions | toSpliced then longer", f238);
function f239() {
  const a = ["p", "q", "r", "s"];
  a.length = a.length + 1;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | length plus one", f239);
function f240() {
  const a = ["p", "q", "r", "s"];
  a.length++;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | length increment", f240);
function f241() {
  const a = ["p", "q", "r", "s"];
  a.length += 2;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | length plus two", f241);
function f242() {
  const a = ["p", "q", "r", "s"];
  a.length = "6";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | length from text", f242);
function f243() {
  const a = ["p", "q", "r", "s"];
  a.length = { valueOf() { return 6; } };
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | length from object", f243);
function f244() {
  const a = ["p", "q", "r", "s"];
  a.length = 0; a[1] = "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | emptied, stored at one", f244);
function f245() {
  const a = ["p", "q", "r", "s"];
  a.length = 0; a.push("t"); a.push("t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | emptied, pushed", f245);
function f246() {
  const a = ["p", "q", "r", "s"];
  a.length = 1; a.length = 3;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | shorter, longer", f246);
function f247() {
  const a = ["p", "q", "r", "s"];
  delete a[0];
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
  for (let k = 0; k < a.length; k += 2) delete a[k];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | delete by variable", f249);
function f250() {
  const a = ["p", "q", "r", "s"];
  a[a.length + 1] = "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | store above length", f250);
function f251() {
  const a = ["p", "q", "r", "s"];
  a[a.length] = "t";
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | store at length", f251);
function f252() {
  const a = ["p", "q", "r", "s"];
  a[40] = "t";
  let s = "";
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
  Object.defineProperty(a, "length", { value: 6 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | define length", f257);
function f258() {
  const a = ["p", "q", "r", "s"];
  Reflect.set(a, 6, "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | reflect set", f258);
function f259() {
  const a = ["p", "q", "r", "s"];
  Reflect.set(a, "length", 6);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | reflect set length", f259);
function f260() {
  const a = ["p", "q", "r", "s"];
  Reflect.deleteProperty(a, 1);
  let s = "";
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
  Array.prototype.pop.call(a);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | pop call", f272);
function f273() {
  const a = ["p", "q", "r", "s"];
  a.push("t"); a.pop(); a.shift(); a.unshift("t", "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | push, pop, shift, unshift", f273);
function f274() {
  const a = ["p", "q", "r", "s"];
  a.splice(1, 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | splice out", f274);
function f275() {
  const a = ["p", "q", "r", "s"];
  a.splice(1, 0, "t", "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | splice in", f275);
function f276() {
  const a = ["p", "q", "r", "s"];
  a.splice(10, 0, "t");
  let s = "";
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
  const o = { get list() { return a; } }; delete o.list[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | with a getter", f300);
function f301() {
  const a = pick ? ["p", "q", "r", "s"] : Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | literal or Array(n)", f301);
function f302() {
  const a = pick ? ["p", "q", "r", "s"] : new Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | literal or new Array(n)", f302);
function f303() {
  const a = !pick ? ["p", "q", "r", "s"] : new Array(3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | Array(n) or literal", f303);
function f304() {
  const a = new Array("t", "t", "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | new Array of items", f304);
function f305() {
  const a = Array.of("t", "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | Array.of", f305);
function f306() {
  const a = ["p", "q", "r", "s"].concat(["p", , "r", "s"]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | concat holes", f306);
function f307() {
  const a = ["p", , "r", "s"].concat(["p", "q", "r", "s"]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes concat", f307);
function f308() {
  const a = ["p", "q", "r", "s"].concat(["p", "q", "r", "s"], "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | concat whole", f308);
function f309() {
  const a = ["p", "q", "r", "s"].concat({ length: 3, 0: "t", [Symbol.isConcatSpreadable]: true });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | concat array-like", f309);
function f310() {
  const a = [...["p", , "r", "s"]];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | spread holes", f310);
function f311() {
  const a = [...["p", "q", "r", "s"], "t"];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | spread whole", f311);
function f312() {
  const a = Array.from({ length: 3 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | from length", f312);
function f313() {
  const a = Array.from(["p", , "r", "s"]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | from holes", f313);
function f314() {
  const a = ["p", , "r", "s"].slice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | slice holes", f314);
function f315() {
  const a = ["p", "q", "r", "s"].slice(1);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | slice whole", f315);
function f316() {
  const a = ["p", , "r", "s"].splice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | splice result holes", f316);
function f317() {
  const a = ["p", "q", "r", "s"].splice(0, 3);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | splice result whole", f317);
function f318() {
  const a = ["p", , "r", "s"].fill("t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes filled", f318);
function f319() {
  const a = ["p", , "r", "s"].fill("t", 2);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes part filled", f319);
function f320() {
  const a = ["p", , "r", "s"].copyWithin(2, 0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes copyWithin", f320);
function f321() {
  const a = ["p", , "r", "s"].sort();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes sorted", f321);
function f322() {
  const a = ["p", , "r", "s"].reverse();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes reversed", f322);
function f323() {
  const a = ["p", , "r", "s"].toReversed();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes toReversed", f323);
function f324() {
  const a = ["p", , "r", "s"].toSorted();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes toSorted", f324);
function f325() {
  const a = ["p", , "r", "s"].toSpliced(0, 1);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes toSpliced", f325);
function f326() {
  const a = ["p", , "r", "s"].with(0, "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes with", f326);
function f327() {
  const a = ["p", , "r", "s"].flat();
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | holes flat", f327);
function f328() {
  const a = Object.keys({ p: 1, q: 2, r: 3 }); delete a[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | keys then delete", f328);
function f329() {
  const a = Object.keys({ p: 1, q: 2, r: 3 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | keys", f329);
function f330() {
  const a = Object.values({ p: "t", q: "t" });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | values", f330);
function f331() {
  const a = "p,q,,r".split(",");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | split", f331);
function f332() {
  const a = "p,q".split(","); a.length = 4;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | split then longer", f332);
function f333() {
  const a = JSON.parse("[1, 2, 3]");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | parsed", f333);
function f334() {
  const a = JSON.parse("[1, 2, 3]", (k, v) => (v === 2 ? undefined : v));
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | parsed and revived", f334);
function f335() {
  const a = ((...rest) => rest)("t", "t", "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | rest", f335);
function f336() {
  const a = ((...rest) => rest)("t", "t", "t"); delete a[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | rest then delete", f336);
function f337() {
  const a = new Array(...[3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | new Array of spread length", f337);
function f338() {
  const a = Array(...[3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | Array of spread length", f338);
function f339() {
  const a = Array.apply(null, [3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | Array applied", f339);
function f340() {
  const a = Reflect.construct(Array, [3]);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | Array constructed", f340);
function f341() {
  const a = new Array(pick ? 3 : "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | new Array of number or item", f341);
function f342() {
  const a = new Array(pick ? "t" : 3);
  let s = "";
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
  class Rows extends Array {} const a = new Rows("t", "t");
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | subclass of items", f344);
function f345() {
  const a = ["t", "t", , ];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | literal with elision at end", f345);
function f346() {
  const a = [...["p", "q", "r", "s"], , "t"];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | spread then elision", f346);
function f347() {
  const a = ["p", , "r", "s"].slice(0).slice(0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | slice of slice of holes", f347);
function f348() {
  const a = ["p", "q", "r", "s"].concat(["p", "q", "r", "s"].concat(["p", , "r", "s"]));
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | concat of concat of holes", f348);
function f349() {
  const a = (pick ? ["p", , "r", "s"] : ["p", "q", "r", "s"]).slice(0);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | slice of either", f349);
function f350() {
  const a = Object.entries({ p: "t", q: "t" })[1];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | entries", f350);
function f351() {
  const a = Reflect.ownKeys({ p: 1, q: 2 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | own keys", f351);
function f352() {
  const a = Object.getOwnPropertyNames({ p: 1, q: 2 });
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | names", f352);
function f353() {
  const a = "p1q22r".split(/\d/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | split by pattern", f353);
function f354() {
  const a = "p1q".split(/(\d)|(x)/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | split with groups", f354);
function f355() {
  const a = "p1q".match(/(\d)|(x)/);
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | match", f355);
function f356() {
  const a = ["p", "q", "r", "s"].with(0, "t"); delete a[2];
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | with then delete", f356);
function f357() {
  const a = ["p", "q", "r", "s"].toSpliced(0, 1); a.length = 5;
  let s = "";
  for (let i = 0; i < a.length; i++) s += (i in a ? "" : "hole ") + a[i] + ",";
  s += "|";
  for (const v of a) s += v + ",";
  s += "|" + a.at(-1) + "," + a.at(9) + "," + a[1] + "," + a.length;
  return s;
}
run("texts | toSpliced then longer", f357);
console.log(lines.join("\n"));
