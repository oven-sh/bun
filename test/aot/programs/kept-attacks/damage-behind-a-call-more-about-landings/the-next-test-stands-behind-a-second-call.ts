// What `holder` has proven about `p` is next asked for behind a second call. The landing of the first call goes on in a copy that holds the second call too,
// and the copy of that call comes back at the landing of its original, so two calls share one landing and the result arrives there as an argument of the edge.
// The damage is done below the first call, below the second, below both, and below the second call of an activation that has already come back at the landing of the first.
// The results of both calls are used behind the join, and one of them does not fit its type in some rounds.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

class Answer {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

let victim: Point | null = null;
let strikeInFirst = false;
let strikeInSecond = false;
let misfit = false;
let hook: any = (n: number) => n;

function strike(kind: number): void {
  const target = victim;
  if (target === null) return;
  if (kind === 0) delete (target as any).x;
  else (target as any).y = "Y" + kind;
}

function one(n: number): Answer {
  hook(n);
  if (strikeInFirst) strike(0);
  return misfit ? ({ value: "odd" } as any) : new Answer(n + 1);
}

function two(n: number): Answer {
  hook(n);
  if (strikeInSecond) strike(n & 1 ? 1 : 2);
  return new Answer(n + 2);
}

function holder(p: Point, n: number): string {
  const before = p.x + p.y;
  const a = one(n);
  const b = two(n);
  const after = p.x + "," + p.y;
  return before + " " + a.value + " " + b.value + " " + after + " " + Object.keys(p).join("");
}

for (let round = 0; round < 800; round++) {
  const p = new Point(round, 1);
  const kind = round % 100 === 99 ? (round + 1) / 100 : 0;
  victim = kind ? p : null;
  strikeInFirst = kind === 1 || kind === 3 || kind === 5 || kind === 7;
  strikeInSecond = kind === 2 || kind === 3 || kind === 6 || kind === 7;
  misfit = kind >= 4;
  const line = holder(p, round);
  if (kind || round === 0) console.log(round + ": " + line);
}
