// `x = parent[x] = parent[parent[x]]` with `x: number`: the loop hands an int32 around, so the position is an integer in it. Only the slow paths hand over anything else:
// a position outside the view reads undefined, and `parent[undefined]` is a property like any other, which here answers a value of every kind in turn.
const parent = new Int32Array(16);
const answers: unknown[] = [2.5, -0, 2147483648, -2147483649, NaN, Infinity, 1e300, 7, "3", null, true, 15, 16, -1, 4294967296, 0.1, { valueOf() { return 2; } }, 1n, 5, undefined];
let asked = 0;
const lines: string[] = [];
Object.defineProperty(parent, "undefined", {
  get() {
    const answer = answers[asked++ % answers.length];
    lines.push("asked " + show(answer));
    return answer;
  },
  set(value: unknown) {
    lines.push("stored " + show(value));
  },
});

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  return typeof value === "object" && value ? "object" : typeof value === "string" ? JSON.stringify(value) : String(value);
}

function find(x: number): number {
  let turns = 0;
  while (parent[x] !== x && turns++ < 12) x = parent[x] = parent[parent[x]!]!;
  return x;
}

function reset() {
  for (let k = 0; k < 16; k++) parent[k] = k;
}

reset();
let sum = 0;
for (let i = 0; i < 30000; i++) {
  if ((i & 15) === 0) reset();
  parent[find(i & 15)] = find((i * 7) & 15);
  sum = (sum + find(i & 15)) | 0;
}
lines.push("sum " + sum + " asked " + asked);

// An element that points outside the view sends the loop to the property.
for (let round = 0; round < 60; round++) {
  reset();
  parent[3] = 100 + round;
  parent[5] = -1 - round;
  parent[9] = 3;
  lines.push(round + ": " + show(find(3)) + " " + show(find(5)) + " " + show(find(9)) + " " + show(find(round & 15)) + " [" + parent.join() + "]");
}
console.log(lines.join("\n"));
