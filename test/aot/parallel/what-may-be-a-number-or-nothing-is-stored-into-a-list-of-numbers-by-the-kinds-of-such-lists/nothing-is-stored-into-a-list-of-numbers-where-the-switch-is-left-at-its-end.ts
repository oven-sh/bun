// a kind that the types do not name comes out of a parse: the switch is left at its end and undefined is stored into the list of numbers; lists that are frozen, sealed or hold a hole take the same stores
type Kind = "one" | "half";
function pick(kind: Kind, depth: number): number {
  if (depth > 0) return pick(kind, depth - 1);
  switch (kind) {
    case "one": return 1;
    case "half": return 0.5;
  }
}
function put(list: number[], at: number, kind: Kind): number { return (list[at] = pick(kind, 1)); }
const kinds = JSON.parse('["one","one","other","half","one","other"]') as Kind[];
const said: string[] = [];
for (let round = 0; round < 40; round++) {
  said.length = 0;
  const whole = [round, 2, 3], halves = [0.5, 1.5, round + 0.5], holed = [1, , 3] as number[], frozen = Object.freeze([1, 2, 3]) as number[], sealed = Object.seal([1, 2, 3]);
  for (const list of [whole, halves, holed, frozen, sealed]) {
    for (let at = 0; at < kinds.length; at++) {
      try { said.push(String(put(list, at, kinds[at]!))); } catch (e) { said.push((e as Error).constructor.name); }
    }
    said.push(JSON.stringify(list), String(list.length));
  }
}
console.log(said.join(" "));
