// An accessor defined on an instance of a class below a built-in class that declares a private name. The instance is a cell of the built-in class.
// Flags: --aot-validate
let hits = 0;
class List extends Array {
  #p = 5;
  m() {
    return this.#p;
  }
}
function onList() {
  const o = new List();
  o.m();
  Object.defineProperty(o, "c", {
    set(x) {
      hits++;
    },
    configurable: true,
  });
  o.c = 1;
  return hits + "|" + o.c + "|" + o.z;
}
class Table extends Map {
  #p = 5;
  m() {
    return this.#p;
  }
}
function onTable() {
  const o = new Table();
  o.m();
  Object.defineProperty(o, "c", {
    set(x) {
      hits++;
    },
    configurable: true,
  });
  o.c = 1;
  return hits + "|" + o.c + "|" + o.z;
}
class Row extends Array {
  #p = 5;
  a = 1;
  b = "x";
  m() {
    return this.a + this.#p;
  }
}
function onRow() {
  const o = new Row();
  o.m();
  Object.defineProperty(o, "c", {
    set(x) {
      this.b = "set" + x;
    },
    configurable: true,
  });
  o.c = 1;
  return [o.length, o[0], Array.isArray(o), o.join("-"), o.a, o.b, o.c, o.m()].join();
}
for (let round = 0; round < 3; round++) console.log(onList(), ";", onTable(), ";", onRow());
