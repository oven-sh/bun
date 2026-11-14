// Env of the executable: BUN_JSC_collectContinuously=1
// Old objects take new ones while the collector marks. What they hold is reachable through them alone: a barrier left out loses it.
class Holder {
  constructor(i) {
    this.i = i;
    this.value = null;
    this.next = null;
  }
  set(value) {
    this.value = value;
    this.next = value.next;
  }
}

function fresh(i) {
  return { i, text: "v" + i, next: { i: i + 1, list: [i, { i: i + 2 }] } };
}

function holds(value, i) {
  return value.i === i && value.text === "v" + i && value.next.i === i + 1 && value.next.list[0] === i && value.next.list[1].i === i + 2;
}

function capture(i) {
  let held = fresh(i);
  return {
    set(value) {
      held = value;
    },
    get() {
      return held;
    },
  };
}

const unknown = JSON.parse('[{"a":1},{"b":2},{"c":3,"d":4}]');
const count = 4000;
const holders = [];
const plain = [];
const captured = [];
const lists = [];
const maps = [];
for (let i = 0; i < count; i++) {
  holders.push(new Holder(i));
  plain.push({ ...unknown[i % 3], held: null });
  captured.push(capture(i));
  lists.push([null, null, null]);
  maps.push(new Map());
}
const long = new Array(3000).fill(null);

let wrong = 0;
for (let round = 0; round < 40; round++) {
  const first = round * count;
  for (let i = 0; i < count; i++) {
    holders[i].set(fresh(first + i));
    plain[i].held = fresh(first + i);
    plain[i]["k" + (round % 5)] = fresh(first + i);
    captured[i].set(fresh(first + i));
    lists[i][round % 3] = fresh(first + i);
    maps[i].set(round % 4, fresh(first + i));
    long[i % long.length] = fresh(first + i);
  }
  for (let i = 0; i < count; i++) {
    if (!holds(holders[i].value, first + i) || holders[i].next !== holders[i].value.next) wrong++;
    if (!holds(plain[i].held, first + i) || !holds(plain[i]["k" + (round % 5)], first + i)) wrong++;
    if (!holds(captured[i].get(), first + i)) wrong++;
    if (!holds(lists[i][round % 3], first + i)) wrong++;
    if (!holds(maps[i].get(round % 4), first + i)) wrong++;
    if (i >= count - long.length && !holds(long[i % long.length], first + i)) wrong++;
  }
}
console.log(wrong, holders.length, lists[7].length, maps[9].size);
