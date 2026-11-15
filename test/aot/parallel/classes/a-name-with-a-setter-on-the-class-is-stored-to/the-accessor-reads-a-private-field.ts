// The accessor of the class keeps its value in a private field, and one object gets a property of the name.
class Room {
  kelvin: number;
  constructor(k: number) { this.kelvin = k; }
  #c = 40; set celsius(v: number) { this.#c = v; this.kelvin = v; }
  get celsius(): number { return this.#c; }
  
}
function warm(room: Room, c: number): void { room.celsius = c; }
function show(tag: string, room: any): void {
  let read: any; try { read = room.celsius; } catch (e: any) { read = "throws " + e.constructor.name; }
  console.log(tag, room.kelvin, read, Object.keys(room).join(), Object.hasOwn(room, "celsius"), JSON.stringify(Object.getOwnPropertyDescriptor(room, "celsius")));
}
function tryWarm(room: Room, c: number): void { try { warm(room, c); } catch (e: any) { console.log("throws", e.constructor.name); } }
const rooms: Room[] = [new Room(1), new Room(2), new Room(3)];
for (let i = 0; i < 5; i++) for (const r of rooms) tryWarm(r, i);
show("before", rooms[0]);
const room: any = rooms[0];
Object.defineProperty(rooms[0], 'celsius', { enumerable: false });
show("attacked", rooms[0]);
tryWarm(rooms[0], 50); show("after", rooms[0]);
tryWarm(rooms[1], 60); show("other", rooms[1]);
const late = new Room(9); tryWarm(late, 70); show("late", late);
