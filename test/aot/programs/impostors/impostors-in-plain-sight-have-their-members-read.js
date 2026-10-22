const log = [];

function show(value) {
  if (Object.is(value, -0)) return "-0";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
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

class Tile {
  constructor(row, column) {
    this.row = row;
    this.column = column;
  }
}

function rowForGetter(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForGetter(new Tile(i, 1));
print("a literal with a getter", () => rowForGetter({ get row() { log.push("get row"); return "got"; }, column: 1 }));
print("honest", () => rowForGetter(new Tile(1, 2)));

function rowForOtherOrder(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForOtherOrder(new Tile(i, 1));
print("a literal in the other order", () => rowForOtherOrder({ column: "c", row: "r" }));
print("honest", () => rowForOtherOrder(new Tile(1, 2)));

function rowForMissing(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForMissing(new Tile(i, 1));
print("a literal without row", () => rowForMissing({ column: "c" }));
print("honest", () => rowForMissing(new Tile(1, 2)));

function rowForDeleted(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForDeleted(new Tile(i, 1));
const deleted = new Tile(1, 2);
delete deleted.row;
print("a tile whose row was deleted", () => rowForDeleted(deleted));
print("honest", () => rowForDeleted(new Tile(1, 2)));

function rowForRedefined(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForRedefined(new Tile(i, 1));
const redefined = new Tile(1, 2);
Object.defineProperty(redefined, "row", { get() { log.push("get row"); return "redefined"; } });
print("a tile whose row became a getter", () => rowForRedefined(redefined));
print("honest", () => rowForRedefined(new Tile(1, 2)));

function rowForString(tile) {
  return tile.row + 1;
}
for (let i = 0; i < 2000; i++) rowForString(new Tile(i, 1));
print("a tile made with a string, row + 1", () => rowForString(new Tile("1", 2)));
print("a tile made with nothing, row + 1", () => rowForString(new Tile()));
print("a tile made with 2 ** 31 - 1, row + 1", () => rowForString(new Tile(2147483647, 2)));
print("a tile made with -1 and 0 * -1", () => [rowForString(new Tile(-1, 2)), new Tile(0 * -1, 2).row]);
print("honest", () => rowForString(new Tile(1, 2)));

function rowForSubclass(tile) {
  return tile.row;
}
class LoudTile extends Tile {
  get row() {
    log.push("get row");
    return "loud";
  }
  set row(value) {
    log.push("set row " + value);
  }
}
for (let i = 0; i < 2000; i++) rowForSubclass(new Tile(i, 1));
print("a subclass whose row is an accessor", () => rowForSubclass(new LoudTile(1, 2)));
print("its own keys", () => Object.keys(new LoudTile(1, 2)));
print("honest", () => rowForSubclass(new Tile(1, 2)));

function rowForPrimitive(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForPrimitive(new Tile(i, 1));
print("a number", () => rowForPrimitive(5));
print("a string", () => rowForPrimitive("tile"));
print("null", () => rowForPrimitive(null));
print("undefined", () => rowForPrimitive(undefined));
print("nothing at all", () => rowForPrimitive());
print("honest", () => rowForPrimitive(new Tile(1, 2)));

function rowForProxy(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForProxy(new Tile(i, 1));
print("a proxy around a tile", () => rowForProxy(new Proxy(new Tile(1, 2), { get(target, key) { log.push("get " + String(key)); return "trapped"; } })));
print("honest", () => rowForProxy(new Tile(1, 2)));

function rowForMoved(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForMoved(new Tile(i, 1));
const moved = new Tile(1, 2);
delete moved.row;
Object.setPrototypeOf(moved, { row: "from the new prototype" });
print("a tile without row under another prototype", () => rowForMoved(moved));
print("honest", () => rowForMoved(new Tile(1, 2)));

function rowForInherited(tile) {
  return tile.row;
}
for (let i = 0; i < 2000; i++) rowForInherited(new Tile(i, 1));
print("an object that inherits from a tile", () => rowForInherited(Object.create(new Tile("inherited", 2))));
print("honest", () => rowForInherited(new Tile(1, 2)));

function rowOnlyImpostors(tile) {
  return tile.row;
}
print("a function that never sees a tile, a literal", () => rowOnlyImpostors({ row: "only" }));
print("a function that never sees a tile, a getter", () => rowOnlyImpostors({ get row() { return "only a getter"; } }));
