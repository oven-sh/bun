const log = [];

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
  return String(value);
}

function print(label, run) {
  let line;
  try {
    line = label + " -> " + show(run());
  } catch (error) {
    line = label + " -> threw " + error.constructor.name;
  }
  console.log(line + (log.length ? " | log " + log.splice(0).join(", ") : ""));
}

console.log("strict code:", (function () { return this === undefined; })());

function Tile(row, column) {
  this.row = row;
  this.column = column;
}
Tile.prototype.moveTo = function (row) {
  this.row = row;
  return this;
};
Tile.prototype.moveDown = function () {
  this.row++;
  return this;
};

function storeIntoFrozen(tile) {
  tile.row = 9;
  return tile;
}
for (let i = 0; i < 2000; i++) storeIntoFrozen(new Tile(i, 1));
print("a frozen tile", () => storeIntoFrozen(Object.freeze(new Tile(1, 2))));
print("a frozen literal", () => storeIntoFrozen(Object.freeze({ row: 1, column: 2 })));
print("honest", () => storeIntoFrozen(new Tile(1, 2)));

function storeIntoReadOnly(tile) {
  tile.row = 9;
  return tile;
}
for (let i = 0; i < 2000; i++) storeIntoReadOnly(new Tile(i, 1));
print("a tile whose row cannot be written", () => storeIntoReadOnly(Object.defineProperty(new Tile(1, 2), "row", { writable: false })));
print("honest", () => storeIntoReadOnly(new Tile(1, 2)));

function storeIntoGetter(tile) {
  tile.row = 9;
  return tile;
}
for (let i = 0; i < 2000; i++) storeIntoGetter(new Tile(i, 1));
print("a literal with only a getter", () => storeIntoGetter({ get row() { return "got"; }, column: 2 }));
print("a literal with a setter", () => storeIntoGetter({ set row(value) { log.push("set row " + value); }, column: 2 }));
print("honest", () => storeIntoGetter(new Tile(1, 2)));

function addToClosed(tile) {
  tile.layer = 9;
  return tile;
}
for (let i = 0; i < 2000; i++) addToClosed(new Tile(i, 1));
print("a new member on a tile that is not extensible", () => addToClosed(Object.preventExtensions(new Tile(1, 2))));
print("a new member on a sealed tile", () => addToClosed(Object.seal(new Tile(1, 2))));
print("honest", () => addToClosed(new Tile(1, 2)));

function storeIntoSealed(tile) {
  tile.row = 9;
  return tile;
}
for (let i = 0; i < 2000; i++) storeIntoSealed(new Tile(i, 1));
print("an old member of a sealed tile", () => storeIntoSealed(Object.seal(new Tile(1, 2))));
print("honest", () => storeIntoSealed(new Tile(1, 2)));

function storeIntoPrimitive(tile) {
  tile.row = 9;
  return tile;
}
for (let i = 0; i < 2000; i++) storeIntoPrimitive(new Tile(i, 1));
print("a number", () => storeIntoPrimitive(5));
print("a string", () => storeIntoPrimitive("tile"));
print("a symbol", () => typeof storeIntoPrimitive(Symbol.iterator));
print("null", () => storeIntoPrimitive(null));
print("undefined", () => storeIntoPrimitive(undefined));
print("honest", () => storeIntoPrimitive(new Tile(1, 2)));

function incrementFrozen(tile) {
  tile.row++;
  return tile;
}
for (let i = 0; i < 2000; i++) incrementFrozen(new Tile(i, 1));
print("row++ on a frozen tile", () => incrementFrozen(Object.freeze(new Tile(1, 2))));
print("row++ on a tile with a string", () => incrementFrozen(new Tile("1", 2)));
print("row++ on a tile with 2 ** 31 - 1", () => incrementFrozen(new Tile(2147483647, 2)));
print("row++ on a tile with a bigint", () => typeof incrementFrozen(new Tile(1n, 2)).row);
print("row++ on a tile with nothing", () => incrementFrozen(new Tile()));
print("honest", () => incrementFrozen(new Tile(1, 2)));

for (let i = 0; i < 2000; i++) new Tile(i, 1).moveTo(3).moveDown();
print("its own method stores into a frozen tile", () => Object.freeze(new Tile(1, 2)).moveTo(9));
print("its own method increments a frozen tile", () => Object.freeze(new Tile(1, 2)).moveDown());
print("its own method stores into a tile whose row is a setter", () => Object.defineProperty(new Tile(1, 2), "row", { set(value) { log.push("set row " + value); }, enumerable: true }).moveTo(9));
print("its own method with a literal as this", () => Tile.prototype.moveTo.call({ column: 1 }, 9));
print("its own method with a number as this", () => typeof Tile.prototype.moveTo.call(5, 9));
print("its own method with undefined as this", () => Tile.prototype.moveTo.call(undefined, 9) === globalThis);
print("which stored into the global object", () => [globalThis.row, delete globalThis.row]);
print("honest", () => new Tile(1, 2).moveTo(3).moveDown());

function storeUnderInheritedReadOnly(tile) {
  tile.row = 9;
  return [Object.hasOwn(tile, "row"), tile.row];
}
for (let i = 0; i < 2000; i++) storeUnderInheritedReadOnly(new Tile(i, 1));
print("an object that inherits from a frozen tile", () => storeUnderInheritedReadOnly(Object.create(Object.freeze(new Tile(1, 2)))));
print("an object that inherits from a tile", () => storeUnderInheritedReadOnly(Object.create(new Tile(1, 2))));
print("honest", () => storeUnderInheritedReadOnly(new Tile(1, 2)));
