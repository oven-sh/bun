// The class has a getter and no setter: every store throws in strict code and adds nothing.
class Room {
  kelvin;
  constructor(k) {
    this.kelvin = k;
  }
  get celsius() {
    return this.kelvin - 273;
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
show("attacked", rooms[0]);
tryWarm(rooms[0], 50);
show("after", rooms[0]);
tryWarm(rooms[1], 60);
show("other", rooms[1]);
const late = new Room(9);
tryWarm(late, 70);
show("late", late);
