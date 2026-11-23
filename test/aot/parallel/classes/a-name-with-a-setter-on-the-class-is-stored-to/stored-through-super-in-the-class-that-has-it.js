// A store through super begins above the class that has the setter and gives the receiver a property of its own.
class Room {
  kelvin;
  constructor(k) {
    this.kelvin = k;
  }
  set celsius(v) {
    this.kelvin = v + 273;
  }
  get celsius() {
    return this.kelvin - 273;
  }
  hide(v) {
    super.celsius = v;
  }
}
function warm(room, c) {
  room.celsius = c;
}
function show(tag, room) {
  let read;
  try {
    read = room.celsius;
  } catch (e) {
    read = "throws " + e.constructor.name;
  }
  console.log(tag, room.kelvin, read, Object.keys(room).join(), Object.hasOwn(room, "celsius"), JSON.stringify(Object.getOwnPropertyDescriptor(room, "celsius")));
}
function tryWarm(room, c) {
  try {
    warm(room, c);
  } catch (e) {
    console.log("throws", e.constructor.name);
  }
}
const rooms = [new Room(1), new Room(2), new Room(3)];
for (let i = 0;i < 5; i++)
  for (const r of rooms)
    tryWarm(r, i);
show("before", rooms[0]);
const room = rooms[0];
rooms[0].hide(7);
show("attacked", rooms[0]);
tryWarm(rooms[0], 50);
show("after", rooms[0]);
tryWarm(rooms[1], 60);
show("other", rooms[1]);
const late = new Room(9);
tryWarm(late, 70);
show("late", late);
