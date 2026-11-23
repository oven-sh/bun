// What a turn asks for beside the rows may put another object where their holder stands: each turn reads and stores the rows of the holder of that moment.
class Shelf {
  bins: number[][];
  constructor(bins: number[][]) {
    this.bins = bins;
  }
}

class Clock {
  passes = 0;
  readonly turnsAt: number;
  constructor(turnsAt: number) {
    this.turnsAt = turnsAt;
  }
  get tick(): number {
    if (++this.passes === this.turnsAt) shelf = spare;
    return 1;
  }
  set hand(value: number) {
    if (value === this.turnsAt) putShelf(spare);
  }
  get length(): number {
    if (++this.passes === this.turnsAt) {
      const other = room;
      other.box = spare;
    }
    return 1;
  }
  get steady(): number {
    this.passes++;
    return 3;
  }
  *[Symbol.iterator](): Generator<number> {
    if (++this.passes === this.turnsAt) shelf = spare;
    yield 1;
  }
}

const row = (n: number, first: number, step: number): number[] => Array.from({ length: n }, (_, i) => (first + i * step) % 97);
const fresh = (): Shelf => new Shelf([row(24, 1, 5), row(24, 2, 7)]);
const other = (): Shelf => new Shelf([row(24, 50, 3), row(24, 60, 11)]);

class Room {
  box = fresh();
  run(n: number, clock: Clock): number {
    let sum = 0;
    this.box = fresh();
    for (let i = 0; i < n; i++) {
      this.box.bins[0][i] = sum & 15;
      sum += this.box.bins[1][i] + clock.length;
    }
    return sum;
  }
}

let shelf = fresh();
let spare = other();
let room = new Room();
let stored: { bins: number[][] } = JSON.parse(JSON.stringify(fresh()));
let laterStored: { bins: number[][] } = JSON.parse(JSON.stringify(other()));

class Sieve {
  passes = 0;
  readonly turnsAt: number;
  constructor(turnsAt: number) {
    this.turnsAt = turnsAt;
  }
  get tick(): number {
    if (++this.passes === this.turnsAt) stored = laterStored;
    return 1;
  }
}

function holderFromText(n: number, sieve: Sieve): number {
  let sum = stored.bins.length - 2;
  for (let i = 0; i < n; i++) {
    sum += stored.bins[1][i];
    stored.bins[0][i] = sum & 31;
    sum += sieve.tick;
  }
  return sum;
}

function putShelf(next: Shelf): void {
  shelf = next;
}

function holderByGetter(n: number, clock: Clock): number {
  let sum = 0;
  shelf = fresh();
  for (let i = 0; i < n; i++) {
    shelf.bins[0][i] = sum & 15;
    sum += shelf.bins[1][i] + clock.tick;
  }
  return sum;
}

function holderBySetter(n: number, clock: Clock): number {
  let sum = 0;
  shelf = fresh();
  for (let i = 0; i < n; i++) {
    sum += shelf.bins[1][i];
    shelf.bins[0][i] = sum & 31;
    clock.hand = i;
  }
  return sum;
}

function holderBySpread(n: number, clock: Clock): number {
  let sum = 0;
  shelf = fresh();
  for (let i = 0; i < n; i++) {
    shelf.bins[0][i] = sum & 15;
    sum += shelf.bins[1][i] + [...clock].length;
  }
  return sum;
}

function holderStays(n: number, clock: Clock): number {
  let sum = 0;
  shelf = fresh();
  for (let i = 0; i < n; i++) {
    shelf.bins[0][i] = sum & 15;
    sum += shelf.bins[1][i] + clock.steady;
  }
  return sum;
}

function holderInField(n: number, clock: Clock): number {
  return room.run(n, clock);
}

for (const weave of [holderByGetter, holderBySetter, holderBySpread, holderStays, holderInField]) {
  for (const turnsAt of [3, 9, 24, 99]) {
    let sum = 0;
    for (let z = 0; z < 20; z++) {
      spare = other();
      sum = weave(24, new Clock(turnsAt));
    }
    console.log(weave.name, turnsAt, sum, JSON.stringify([shelf.bins, spare.bins, room.box.bins]));
  }
}

for (const turnsAt of [3, 9, 24, 99]) {
  let sum = 0;
  for (let z = 0; z < 20; z++) {
    stored = JSON.parse(JSON.stringify(fresh()));
    laterStored = JSON.parse(JSON.stringify(other()));
    sum = holderFromText(24, new Sieve(turnsAt));
  }
  console.log("holderFromText", turnsAt, sum, JSON.stringify([stored.bins, laterStored.bins]));
}

export {};
