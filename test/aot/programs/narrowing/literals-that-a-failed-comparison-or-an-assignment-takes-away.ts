// Behind a failed `kind === "alpha"` the checker takes "alpha" out of the union, and behind `done = false` it holds `done` for false. Nothing is tested for that: the value keeps the type it had.
// The checker is wrong about `done`, `count` and `last`: a closure assigns them behind its back.
type Kind = "alpha" | "beta" | "gamma" | "delta" | "epsilon" | "zeta" | "eta" | "theta";
function isGate(kind: Kind): boolean {
  return kind === "alpha" || kind === "beta" || kind === "gamma" || kind === "delta";
}
function rank(kind: Kind): number {
  if (kind === "alpha") return 1;
  if (kind === "beta") return 2;
  if (kind !== "gamma" && kind !== "delta") return kind === "theta" ? 8 : kind.length;
  return kind === "gamma" ? 3 : 4;
}
const all: Kind[] = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
let gates = 0;
let ranks = 0;
for (let i = 0; i < 64; i++) {
  const kind = JSON.parse(JSON.stringify(all[i & 7])) as Kind;
  if (isGate(kind)) gates++;
  ranks += rank(kind);
}
console.log(gates, ranks);

function walk(items: number[], visit: (item: number) => void): void {
  for (const item of items) visit(item);
}
function findsEven(items: number[]): string {
  let done = false;
  let count = 0;
  let last: "none" | "even" | "odd" = "none";
  walk(items, item => {
    if (item % 2 === 0) done = true;
    count++;
    last = item % 2 === 0 ? "even" : "odd";
  });
  const seen = done ? "found" : "missing";
  const many = count === 0 ? "empty" : "some " + count;
  return seen + " " + many + " " + (last === "none" ? "nothing" : last);
}
console.log(findsEven([1, 3, 5]), "|", findsEven([1, 2, 3]), "|", findsEven([]), "|", findsEven([4]));
console.log(isGate("omega" as Kind), rank("omega" as Kind), isGate(undefined as unknown as Kind), isGate(7 as unknown as Kind));
