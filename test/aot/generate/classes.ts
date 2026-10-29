// The programs of classes that are mostly a table written out: blocks of lines that differ in a few places.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "prototype-objects-of-classes-change-behind-warm-reads-by-name.js": text(
      `// Objects of classes are read by names that only the run knows, many times, so that whatever remembers an answer has remembered it. Then the prototype object of the class,
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

const makers = [];`,
      [
        28,
        n => `makers.push(() => {
  class Top${n} { field = "t"; top() { return "top"; } other() { return "other of top"; } }
  class Middle${n} extends Top${n} { inherited() { return "inherited"; } get value() { return "got " + this.field; } }
  class Bottom${n} extends Middle${n} { field = "b"; method() { return "method " + this.field; } other() { return "other of bottom"; } }
  class Beside${n} extends Middle${n} { method() { return "beside"; } }
  return [Top${n}, Middle${n}, Bottom${n}, Beside${n}];
});`,
      ],
      `scenario('nothing changes', () => {});
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
console.log(lines.join("\\n"));
`,
    ),
  });
