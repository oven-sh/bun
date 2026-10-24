declare const aotOperationCount: (name: string) => number;
// An object literal typed any is passed to a parameter of a record type that has fields whose types are unions of string literals: any object passes, and a member that typed code never reads is never tested. Literals that fit do not enter the runtime's type check once per object, whichever texts the fields hold.
type Author = { login: string };
type Hit = { id: number; state: "open" | "closed"; level: "low" | "high"; author: Author; note?: string };

function makeAuthor(login: string): Author {
  return { login };
}
function typedHit(): Hit {
  return { id: 0, state: "open", level: "low", author: makeAuthor("typed") };
}
function stamp(hit: Hit, id: number): Hit {
  hit.id += id;
  return hit;
}
function weigh(hit: Hit): number {
  return hit.id + (hit.state === "closed" ? 1 : 2) + hit.level.length + hit.author.login.length;
}

console.log(JSON.stringify(stamp(typedHit(), 1)), weigh(typedHit()));
const author = makeAuthor("u");
let last: Hit = typedHit();
let sum = 0;
const before = aotOperationCount("operationAOTEnforceType");
for (let i = 0; i < 400; i++) {
  const hit: any = { id: i, state: i % 2 ? "open" : "closed", level: i % 4 < 2 ? "low" : "high", author };
  last = stamp(hit, 1);
  sum += weigh(last);
}
const slow = aotOperationCount("operationAOTEnforceType") - before;
console.log(sum, slow < 20 ? "without the runtime" : "through the runtime: " + slow);
console.log(JSON.stringify(last), Object.keys(last).join(), last.author === author, last.note);
last.note = "late";
console.log(JSON.stringify(last), Object.keys(last).join());
for (const [state, level] of [["other", "low"], ["open", "middle"], [5, "low"], [null, "low"], [undefined, "low"], ["open", "opened for good"]]) {
  try {
    const hit: any = { id: 1, state, level, author };
    console.log(JSON.stringify(stamp(hit, 1)));
  } catch (e) {
    console.log(e instanceof Error ? e.name + ": " + e.message.split("\n")[0].replace(/ \(bun compile[^)]*\)/, "") : String(e));
  }
}
