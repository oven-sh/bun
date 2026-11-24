"use strict";

// A loop steps a field of an object that nothing else is known of by one.
class Lift {
  constructor(floor) {
    this.floor = floor;
  }
}

const doors = new Map();
for (let i = 0; i < 200; i += 10) doors.set(i, { number: i });
for (const i of [2147483645, 2147483647, 2147483648, -2147483648, -2147483649]) doors.set(i, { number: i });

function run(lift, last) {
  const opened = [];
  for (;;) {
    if (lift.floor === null || lift.floor === undefined || !(lift.floor <= last)) return `${opened.join()} ${lift.floor}`;
    const door = doors.get(lift.floor++);
    if (door !== undefined) {
      opened.push(door.number);
      if (door.number === 150) lift.floor = null;
    }
  }
}

function runBack(lift, first) {
  let found = 0;
  while (lift.floor != null && lift.floor >= first) {
    if (doors.has(lift.floor--)) found++;
  }
  return `${found} ${lift.floor}`;
}

const lifts = [new Lift(0), { floor: 0 }, { name: "a", floor: 0 }, { floor: 0, name: "b" }];
globalThis.lifts = lifts;
for (const lift of lifts) {
  for (const [first, last] of [[0, 90], [0, 300], [-5, 12], [0.5, 12], [2147483640, 2147483655], [2147483647, 2147483650], [-2147483652, -2147483640], [9007199254740990, 9007199254740992 - 2], [NaN, 4], ["7", 20], [null, 4], [undefined, 4]]) {
    lift.floor = first;
    const forward = run(lift, last);
    lift.floor = first;
    const back = first > 1e15 ? "" : runBack(lift, first - 8);
    console.log(String(first), forward, "|", back);
  }
}

const frozen = Object.freeze({ floor: 3 });
try {
  console.log(run(frozen, 9));
} catch (error) {
  console.log(error.name, frozen.floor);
}
let reads = 0;
const accessor = {
  get floor() {
    reads++;
    return reads < 12 ? reads : null;
  },
  set floor(value) {},
};
console.log(run(accessor, 100), reads);
