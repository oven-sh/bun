// A factory makes the class twice and the accessor of one of the two is deleted.
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
function make(sign: number) { return class Cell { kelvin = 0; set celsius(v: number) { this.kelvin = sign * v; } get celsius(): number { return this.kelvin; } }; } const A = make(1), B = make(-1); const a = new A(), b = new B(); function put(c: InstanceType<typeof A>, v: number) { c.celsius = v; } for (let i = 0; i < 4; i++) { put(a, i); put(b, i); } delete (B.prototype as any).celsius; put(a, 9); put(b, 9); show('a', a); show('b', b);
show("attacked", rooms[0]);
tryWarm(rooms[0], 50); show("after", rooms[0]);
tryWarm(rooms[1], 60); show("other", rooms[1]);
const late = new Room(9); tryWarm(late, 70); show("late", late);
