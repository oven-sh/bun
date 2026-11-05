// Several accesses of one object in a row. The first finds its field gone and goes by name, which runs a getter of the prototype, and the getter alters the very object:
// what follows must see the object as it is then.
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));
const lines = [];

let alter = () => {};
class Box {
  constructor(a, b, c) { this.a = a; this.b = b; this.c = c; }
  describe() { return "Box " + this.b; }
  get sum() { return this.b + this.c; }
}
const inherited = { configurable: true, get() { alter(this); return "inherited a"; }, set(value) { alter(this); } };

function readThree(o) { return o.a + " | " + o.b + " | " + o.c; }
function readAndCall(o) { return o.a + " | " + o.describe() + " | " + o.sum; }
function readAndStore(o) { const first = o.a; o.b = "stored"; o.c = "stored too"; return first + " | " + o.b + " | " + o.c + " | " + Object.keys(o).join(); }
function storeAndRead(o) { o.a = "new a"; return o.b + " | " + o.c + " | " + ("a" in o) + " | " + Object.keys(o).join(); }
function readInLoop(o) { let text = ""; for (let i = 0; i < 3; i++) text += o.a + ":" + o.b + ":" + o.c + ";"; return text; }
const uses = { readThree, readAndCall, readAndStore, storeAndRead, readInLoop };

const alterations = {
  nothing() {},
  "an accessor in place of b"(o) { Object.defineProperty(o, "b", { configurable: true, enumerable: true, get() { return "b by getter"; }, set() {} }); },
  "b is deleted"(o) { delete o.b; },
  "b and c are deleted and added again"(o) { delete o.b; delete o.c; o.c = "late c"; o.b = "late b"; },
  "an indexed accessor"(o) { Object.defineProperty(o, 0, { configurable: true, get() { return "zero"; } }); },
  "another prototype"(o) { Object.setPrototypeOf(o, { describe() { return "other " + this.b; }, get sum() { return "other sum"; }, get a() { return "other a"; } }); },
  "own members hide those of the class"(o) { o.describe = function () { return "own " + this.b; }; Object.defineProperty(o, "sum", { configurable: true, value: "own sum" }); },
  "frozen"(o) { Object.freeze(o); },
  "b holds another kind of value"(o) { o.b = { toString() { return "an object in b"; } }; o.c = 1.5; },
  "many more properties"(o) { for (let i = 0; i < 40; i++) o["extra" + i] = i; },
  "the method of the class is replaced"(o) { Box.prototype.describe = function () { return "replaced " + this.b; }; },
};

const describe = Box.prototype.describe;
for (const [useName, use] of Object.entries(uses)) {
  for (const [alterationName, alteration] of Object.entries(alterations)) {
    for (const hide of [value => value, unknown]) {
      Box.prototype.describe = describe;
      delete Box.prototype.a;
      alter = () => {};
      let text = "";
      for (let warm = 0; warm < 3; warm++) text = use(hide(new Box("a", "b", "c")));
      const box = hide(new Box("a", "b", "c"));
      delete box.a;
      Object.defineProperty(Box.prototype, "a", inherited);
      let ran = 0;
      alter = o => { if (!ran++) alteration(o); };
      let result;
      try { result = use(box); } catch (error) { result = error.constructor.name; }
      let again;
      try { again = use(box); } catch (error) { again = error.constructor.name; }
      lines.push(useName + ", " + alterationName + (hide === unknown ? ", unknown" : "") + ": " + text + " || " + result + " || " + again);
    }
  }
}
console.log(lines.join("\n"));
