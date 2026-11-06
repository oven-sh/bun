// Reflect.construct makes an object for another function, whose prototype has no such accessor: a store adds a property.
class Room {
  kelvin: number;
  constructor(k: number) { this.kelvin = k; }
  set celsius(v: number) { this.kelvin = v + 273; }
  get celsius(): number { return this.kelvin - 273; }
  
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
function Other() {} const odd: any = Reflect.construct(Room, [5], Other); tryWarm(odd, 8); show('odd', odd); tryWarm(odd, 9); show('odd', odd);
show("attacked", rooms[0]);
tryWarm(rooms[0], 50); show("after", rooms[0]);
tryWarm(rooms[1], 60); show("other", rooms[1]);
const late = new Room(9); tryWarm(late, 70); show("late", late);
