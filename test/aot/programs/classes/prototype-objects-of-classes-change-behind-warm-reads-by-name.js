// Objects of classes are read by names that only the run knows, many times, so that whatever remembers an answer has remembered it. Then the prototype object of the class,
// or of a class above it, changes in one way, and the same reads are made again: on the old objects, on new ones, and on objects of the classes below.
const unseen = new Function("x", "return x");
const lines = [];
const names = unseen(["field", "method", "other", "value", "inherited", "top", "missing", "constructor", "added", "toString", "hasOwnProperty"]);

function show(value) {
  if (typeof value === "function") return "f:" + value.name;
  return String(value);
}
function readAll(object) {
  let answer = "";
  for (let round = 0; round < 40; round++) {
    answer = "";
    for (const name of names) answer += show(object[name]) + " ";
  }
  return answer + "| " + names.map(name => (name in object ? "1" : "0")).join("");
}
function callAll(object) {
  let answer = "";
  for (let round = 0; round < 40; round++) {
    answer = "";
    for (const name of ["method", "other", "inherited", "top"]) {
      const found = object[name];
      answer += (typeof found === "function" ? object[name]() : "none") + " ";
    }
  }
  return answer;
}

let family = 0;
function scenario(label, change) {
  family++;
  // The text of the classes is evaluated once for each scenario through its own copy below.
  const [Top, Middle, Bottom, Beside] = makers[family - 1]();
  const objects = [new Top(), new Middle(), new Bottom(), new Beside()];
  const before = objects.map(object => readAll(object) + " # " + callAll(object));
  change(unseen({ Top, Middle, Bottom, Beside, objects }));
  const after = objects.map(object => readAll(object) + " # " + callAll(object));
  const fresh = [new Top(), new Middle(), new Bottom(), new Beside()].map(object => readAll(object) + " # " + callAll(object));
  lines.push("== " + label);
  before.forEach((line, index) => {
    lines.push("  " + index + " before " + line);
    lines.push("  " + index + (after[index] === line ? " after: the same" : " after  " + after[index]));
    lines.push("  " + index + (fresh[index] === after[index] ? " fresh: as after" : " fresh  " + fresh[index]));
  });
}

const makers = [];
makers.push(() => {
  class Top0 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle0 extends Top0 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom0 extends Middle0 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside0 extends Middle0 { method() { return "beside"; } }
  return [Top0, Middle0, Bottom0, Beside0];
});
makers.push(() => {
  class Top1 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle1 extends Top1 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom1 extends Middle1 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside1 extends Middle1 { method() { return "beside"; } }
  return [Top1, Middle1, Bottom1, Beside1];
});
makers.push(() => {
  class Top2 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle2 extends Top2 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom2 extends Middle2 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside2 extends Middle2 { method() { return "beside"; } }
  return [Top2, Middle2, Bottom2, Beside2];
});
makers.push(() => {
  class Top3 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle3 extends Top3 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom3 extends Middle3 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside3 extends Middle3 { method() { return "beside"; } }
  return [Top3, Middle3, Bottom3, Beside3];
});
makers.push(() => {
  class Top4 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle4 extends Top4 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom4 extends Middle4 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside4 extends Middle4 { method() { return "beside"; } }
  return [Top4, Middle4, Bottom4, Beside4];
});
makers.push(() => {
  class Top5 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle5 extends Top5 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom5 extends Middle5 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside5 extends Middle5 { method() { return "beside"; } }
  return [Top5, Middle5, Bottom5, Beside5];
});
makers.push(() => {
  class Top6 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle6 extends Top6 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom6 extends Middle6 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside6 extends Middle6 { method() { return "beside"; } }
  return [Top6, Middle6, Bottom6, Beside6];
});
makers.push(() => {
  class Top7 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle7 extends Top7 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom7 extends Middle7 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside7 extends Middle7 { method() { return "beside"; } }
  return [Top7, Middle7, Bottom7, Beside7];
});
makers.push(() => {
  class Top8 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle8 extends Top8 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom8 extends Middle8 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside8 extends Middle8 { method() { return "beside"; } }
  return [Top8, Middle8, Bottom8, Beside8];
});
makers.push(() => {
  class Top9 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle9 extends Top9 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom9 extends Middle9 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside9 extends Middle9 { method() { return "beside"; } }
  return [Top9, Middle9, Bottom9, Beside9];
});
makers.push(() => {
  class Top10 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle10 extends Top10 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom10 extends Middle10 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside10 extends Middle10 { method() { return "beside"; } }
  return [Top10, Middle10, Bottom10, Beside10];
});
makers.push(() => {
  class Top11 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle11 extends Top11 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom11 extends Middle11 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside11 extends Middle11 { method() { return "beside"; } }
  return [Top11, Middle11, Bottom11, Beside11];
});
makers.push(() => {
  class Top12 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle12 extends Top12 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom12 extends Middle12 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside12 extends Middle12 { method() { return "beside"; } }
  return [Top12, Middle12, Bottom12, Beside12];
});
makers.push(() => {
  class Top13 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle13 extends Top13 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom13 extends Middle13 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside13 extends Middle13 { method() { return "beside"; } }
  return [Top13, Middle13, Bottom13, Beside13];
});
makers.push(() => {
  class Top14 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle14 extends Top14 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom14 extends Middle14 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside14 extends Middle14 { method() { return "beside"; } }
  return [Top14, Middle14, Bottom14, Beside14];
});
makers.push(() => {
  class Top15 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle15 extends Top15 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom15 extends Middle15 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside15 extends Middle15 { method() { return "beside"; } }
  return [Top15, Middle15, Bottom15, Beside15];
});
makers.push(() => {
  class Top16 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle16 extends Top16 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom16 extends Middle16 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside16 extends Middle16 { method() { return "beside"; } }
  return [Top16, Middle16, Bottom16, Beside16];
});
makers.push(() => {
  class Top17 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle17 extends Top17 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom17 extends Middle17 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside17 extends Middle17 { method() { return "beside"; } }
  return [Top17, Middle17, Bottom17, Beside17];
});
makers.push(() => {
  class Top18 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle18 extends Top18 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom18 extends Middle18 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside18 extends Middle18 { method() { return "beside"; } }
  return [Top18, Middle18, Bottom18, Beside18];
});
makers.push(() => {
  class Top19 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle19 extends Top19 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom19 extends Middle19 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside19 extends Middle19 { method() { return "beside"; } }
  return [Top19, Middle19, Bottom19, Beside19];
});
makers.push(() => {
  class Top20 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle20 extends Top20 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom20 extends Middle20 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside20 extends Middle20 { method() { return "beside"; } }
  return [Top20, Middle20, Bottom20, Beside20];
});
makers.push(() => {
  class Top21 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle21 extends Top21 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom21 extends Middle21 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside21 extends Middle21 { method() { return "beside"; } }
  return [Top21, Middle21, Bottom21, Beside21];
});
makers.push(() => {
  class Top22 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle22 extends Top22 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom22 extends Middle22 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside22 extends Middle22 { method() { return "beside"; } }
  return [Top22, Middle22, Bottom22, Beside22];
});
makers.push(() => {
  class Top23 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle23 extends Top23 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom23 extends Middle23 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside23 extends Middle23 { method() { return "beside"; } }
  return [Top23, Middle23, Bottom23, Beside23];
});
makers.push(() => {
  class Top24 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle24 extends Top24 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom24 extends Middle24 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside24 extends Middle24 { method() { return "beside"; } }
  return [Top24, Middle24, Bottom24, Beside24];
});
makers.push(() => {
  class Top25 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle25 extends Top25 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom25 extends Middle25 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside25 extends Middle25 { method() { return "beside"; } }
  return [Top25, Middle25, Bottom25, Beside25];
});
makers.push(() => {
  class Top26 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle26 extends Top26 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom26 extends Middle26 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside26 extends Middle26 { method() { return "beside"; } }
  return [Top26, Middle26, Bottom26, Beside26];
});
makers.push(() => {
  class Top27 { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle27 extends Top27 { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom27 extends Middle27 { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside27 extends Middle27 { method() { return "beside"; } }
  return [Top27, Middle27, Bottom27, Beside27];
});
scenario('nothing changes', () => {});
scenario('a method is added to the class', ({ Bottom }) => { Bottom.prototype.added = function added() { return 'added'; }; });
scenario('a method is added to the class in the middle', ({ Middle }) => { Middle.prototype.added = function added() { return 'added'; }; });
scenario('a method is added to the top class', ({ Top }) => { Top.prototype.missing = function missing() { return 'found'; }; });
scenario('a method is replaced', ({ Bottom }) => { Bottom.prototype.method = function replaced() { return 'replaced'; }; });
scenario('an inherited method is replaced where it is declared', ({ Middle }) => { Middle.prototype.inherited = function replaced() { return 'replaced'; }; });
scenario('an inherited method is hidden below', ({ Bottom }) => { Bottom.prototype.top = function hidden() { return 'hidden'; }; });
scenario('a method is deleted', ({ Bottom }) => { delete Bottom.prototype.method; });
scenario('a method of the top class is deleted', ({ Top }) => { delete Top.prototype.top; });
scenario('a getter is replaced by a value', ({ Middle }) => { Object.defineProperty(Middle.prototype, 'value', { value: 'plain', configurable: true }); });
scenario('a method is replaced by a getter', ({ Top }) => { Object.defineProperty(Top.prototype, 'top', { get() { return function got() { return 'got'; }; }, configurable: true }); });
scenario("the getter's function is replaced", ({ Middle }) => { Object.defineProperty(Middle.prototype, 'value', { get() { return 'other getter'; } }); });
scenario('the link of the class moves', ({ Bottom, Top }) => { Object.setPrototypeOf(Bottom.prototype, Top.prototype); });
scenario('the link of the class in the middle moves', ({ Middle }) => { Object.setPrototypeOf(Middle.prototype, { top() { return 'elsewhere'; }, added: 'from elsewhere' }); });
scenario('the link of the top class moves', ({ Top }) => { Object.setPrototypeOf(Top.prototype, { missing: 'above the top' }); });
scenario('the link of the top class goes to null', ({ Top }) => { Object.setPrototypeOf(Top.prototype, null); });
scenario('a proxy is hung above the class in the middle', ({ Middle, Top }) => { Object.setPrototypeOf(Middle.prototype, new Proxy(Top.prototype, { get(target, name, receiver) { return name === 'missing' ? 'by the proxy' : Reflect.get(target, name, receiver); }, has(target, name) { return name === 'missing' || name in target; } })); });
scenario('the prototype object is frozen, then written', ({ Bottom }) => { Object.freeze(Bottom.prototype); try { Bottom.prototype.method = 1; } catch {} });
scenario('the prototype object is only looked at', ({ Bottom, Middle, Top }) => { Object.keys(Bottom.prototype); Object.getOwnPropertyNames(Middle.prototype); JSON.stringify(Top.prototype); Reflect.ownKeys(Top.prototype); });
scenario('the prototype object is looked at, then a method is replaced', ({ Middle }) => { Object.getOwnPropertyDescriptors(Middle.prototype); Middle.prototype.inherited = function later() { return 'later'; }; });
scenario('constructor is replaced', ({ Bottom }) => { Bottom.prototype.constructor = function Other() {}; });
scenario("one object gets a property of a method's name", ({ objects }) => { objects[2].method = function own() { return 'own'; }; objects[1].missing = 'own'; });
scenario('one object gets another prototype', ({ objects, Beside }) => { Object.setPrototypeOf(objects[2], Beside.prototype); });
scenario('one object loses its field', ({ objects }) => { delete objects[2].field; delete objects[0].field; });
scenario("a field's name gets onto the prototype object", ({ Middle, objects }) => { Middle.prototype.field = 'from above'; delete objects[2].field; });
scenario('a symbol and an index get onto the prototype object', ({ Bottom }) => { Bottom.prototype[Symbol.iterator] = function* () {}; Bottom.prototype[0] = 'zero'; });
scenario('two changes, the second puts the first back', ({ Bottom }) => { const kept = Bottom.prototype.method; Bottom.prototype.method = function between() { return 'between'; }; Bottom.prototype.method = kept; });
console.log(lines.join("\n"));
