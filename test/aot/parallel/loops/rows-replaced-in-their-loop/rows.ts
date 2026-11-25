// What a turn asks for beside the rows may lay another list of rows in their place: each turn reads and stores the rows as they stand.
class Loom {
  threads: number[][];
  readonly spare: number[][];
  passes = 0;
  readonly turnsAt: number;
  constructor(threads: number[][], spare: number[][], turnsAt: number) {
    this.threads = threads;
    this.spare = spare;
    this.turnsAt = turnsAt;
  }
  get shuttle(): number {
    if (++this.passes === this.turnsAt) this.threads = this.spare;
    return 1;
  }
  set tension(value: number) {
    if (value === this.turnsAt) this.threads = this.spare;
  }
  get steady(): number {
    this.passes++;
    return 3;
  }
}

function wholeListByGetter(loom: Loom, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    loom.threads[0][i] = sum & 15;
    sum += loom.threads[1][i] + loom.shuttle;
  }
  return sum;
}

function wholeListBySetter(loom: Loom, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += loom.threads[1][i];
    loom.threads[0][i] = sum & 31;
    loom.tension = i;
  }
  return sum;
}

function readersAlone(loom: Loom, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += loom.threads[0][i] * loom.threads[1][i] + loom.shuttle;
  return sum;
}

function rowsStay(loom: Loom, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    loom.threads[0][i] = sum & 15;
    sum += loom.threads[1][i] + loom.steady;
  }
  return sum;
}

const row = (n: number, first: number, step: number): number[] => Array.from({ length: n }, (_, i) => (first + i * step) % 97);

function make(turnsAt: number): Loom {
  return new Loom([row(24, 1, 5), row(24, 2, 7)], [row(24, 50, 3), row(24, 60, 11)], turnsAt);
}

for (const weave of [wholeListByGetter, wholeListBySetter, readersAlone, rowsStay]) {
  for (const turnsAt of [3, 9, 24, 99]) {
    let sum = 0;
    for (let z = 0; z < 20; z++) sum = weave(make(turnsAt), 24);
    const loom = make(turnsAt);
    console.log(weave.name, turnsAt, sum, weave(loom, 24), loom.passes, JSON.stringify(loom.threads), JSON.stringify(loom.spare));
  }
}

export {};
