// Each loop carries a variable of a declared type round a for-in loop over an object whose names are known. At every set of positions the value is of another kind.
type Scores = Record<string, number>;

interface Held { a: unknown; b: unknown; c: unknown }
const count = 3;
function make(values: unknown[]): Scores {
  const made: Held = { a: 0, b: 0, c: 0 };
  made.a = values[0];
  made.b = values[1];
  made.c = values[2];
  return made as unknown as Scores;
}

function assigned(scores: Scores): string {
  let last = 0;
  let order = "";
  for (const key in scores) {
    last = scores[key];
    order += key;
  }
  return order + ":" + String(last);
}

function twoCarried(scores: Scores): string {
  let last = 0;
  let before = 0;
  let order = "";
  for (const key in scores) {
    before = last;
    last = scores[key];
    order += key;
  }
  return order + ":" + String(before) + ":" + String(last);
}

function summed(scores: Scores): string {
  let sum = 0;
  let turns = 0;
  for (const key in scores) {
    sum += scores[key];
    turns++;
  }
  return turns + ":" + String(sum);
}

function continued(scores: Scores): string {
  let last = 0;
  let order = "";
  for (const key in scores) {
    if (key === "b") continue;
    last = scores[key];
    order += key;
  }
  return order + ":" + String(last);
}

function continuedBehindTheRead(scores: Scores): string {
  let last = 0;
  let order = "";
  for (const key in scores) {
    last = scores[key];
    if (key === "a" || key === "c") continue;
    order += key;
  }
  return order + ":" + String(last);
}

function broken(scores: Scores): string {
  let last = 0;
  let order = "";
  for (const key in scores) {
    last = scores[key];
    order += key;
    if (key === "c") break;
  }
  return order + ":" + String(last);
}

function nested(scores: Scores): string {
  let last = 0;
  let order = "";
  for (const outer in scores) {
    last = scores[outer];
    for (const inner in scores) {
      last = scores[inner];
      order += outer + inner + " ";
    }
  }
  return order + ":" + String(last);
}

function labeled(scores: Scores): string {
  let last = 0;
  let order = "";
  outer: for (const first in scores) {
    last = scores[first];
    for (const second in scores) {
      last = scores[second];
      order += first + second + " ";
      if (second === "b") continue outer;
      if (first === "c") break outer;
    }
  }
  return order + ":" + String(last);
}

function deletesALaterName(scores: Scores): string {
  let last = 0;
  let order = "";
  for (const key in scores) {
    last = scores[key];
    order += key;
    if (key === "a") delete scores.c;
  }
  return order + ":" + String(last);
}

function addsAName(scores: Scores): string {
  let last = 0;
  let turns = 0;
  for (const key in scores) {
    last = scores[key];
    turns++;
    if (key === "b") scores.z = 9;
  }
  return (turns >= Object.keys(scores).length - 1) + ":" + Object.keys(scores).join("");
}

function guarded(scores: Scores): string {
  let last = 0;
  let order = "";
  for (const key in scores) {
    try {
      last = scores[key];
      order += key;
    } finally {
      order += ".";
    }
  }
  return order + ":" + String(last);
}

function* yielded(scores: Scores): Generator<string> {
  let last = 0;
  for (const key in scores) {
    last = scores[key];
    yield key + String(last);
  }
}

async function awaited(scores: Scores): Promise<string> {
  let last = 0;
  let order = "";
  for (const key in scores) {
    last = scores[key];
    await null;
    order += key;
  }
  return order + ":" + String(last);
}

const loops = { assigned, twoCarried, summed, continued, continuedBehindTheRead, broken, nested, labeled, deletesALaterName, addsAName, guarded };
const others: unknown[] = ["x", undefined, null, true, { toString: () => "o" }];

for (let turn = 0; turn < 300; turn++) for (const loop of Object.values(loops)) loop(make([1, 2, 3]));

for (let set = 0; set < 1 << count; set++) {
  for (const other of set ? others : [0]) {
    const values = () => [1, 2, 3].map((value, index) => (set & (1 << index) ? other : value));
    const line: string[] = [];
    for (const [name, loop] of Object.entries(loops)) line.push(name + "=" + loop(make(values())));
    line.push("yielded=" + [...yielded(make(values()))].join());
    line.push("awaited=" + (await awaited(make(values()))));
    console.log(set, String(other), line.join(" | "));
  }
}
