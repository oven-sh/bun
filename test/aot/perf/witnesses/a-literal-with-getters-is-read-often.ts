// A literal with data fields and getters between them, read very often through a value that the compiler knows only by its type. The getters lie outside the slots of
// the object. A test of the whole object ("every field that the literal lists is there") failed for such an object at every read, and each read then went by name.
interface Shelf { name: string; boards: number }
interface Room {
  readonly shelf: Shelf;
  readonly key: string;
  readonly self: Room;
  readonly window: { width: number } | null;
  tally: { total: number };
  label: string;
}
// What native code hands back is unknown to the compiler.
const handedBack = <T>(value: T): T => new CustomEvent("handed back", { detail: value }).detail as T;

function furnish(shelf: Shelf, key: string, width: number | null): Room {
  const held = { window: width === null ? null : { width } };
  const room: Room = {
    shelf,
    get key() { return key; },
    get self() { return room; },
    get window() { return held.window; },
    tally: { total: 0 },
    label: "room " + key,
  };
  return room;
}

let room: Room = handedBack(furnish(handedBack({ name: "oak", boards: 3 }), "a", 90));
function current(): Room { return room; }
function boards(): number { return current().shelf.boards; }
function count(): number { const here = current(); here.tally.total += here.shelf.boards; return here.label.length; }

let sum = 0;
for (let turn = 0; turn < 3_000_000; turn++) {
  sum += boards() + count();
  if ((turn & 0xfffff) === 0xfffff) room = handedBack(room);
}
console.log(sum, room.tally.total, room.key, room.window?.width, room.self === room);
