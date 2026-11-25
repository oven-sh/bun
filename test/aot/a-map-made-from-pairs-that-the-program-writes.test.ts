import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// `new Map([["a", 1]])`: the first element of a written pair is a key and the second a value. Whatever changes a pair after it is written has to count.
// A written list says its first two elements apart only once something reads it as a pair, so the lists here that nothing reads so have to stay as they are.
const program = `
import pairsOfFile from "./pairs.json";
import rowsOfFile from "./rows.json";
function show(name, map) {
  const rows = [];
  for (const [key, value] of map) rows.push(typeof key + ":" + String(key) + "=" + typeof value + ":" + String(value));
  console.log(name, rows.join(" "));
}
const seed = Number(process.argv.length);
show("constants", new Map([["a", 1], ["b", 2.5]]));
show("computed", new Map([["a" + seed, seed], [seed, "a" + seed]]));
show("objects", new Map([[{ k: 1 }.k, { v: 2 }.v], [[1, 2].length, [3].length]]));
show("nested", new Map([[["x", 1], { y: 2 }]].map(([a, b]) => [a[0], b.y])));
show("a third element", new Map([["a", 1, "ignored"], ["b", 2, 3]]));
show("too short", new Map([["a"], ["b", 2]]));
show("with undefined", new Map([[undefined, null], ["b", undefined]]));
const popped = ["a", 1];
popped.pop();
show("pop", new Map([popped]));
const shifted = ["a", 1];
shifted.shift();
show("shift", new Map([shifted]));
const stored = ["a", 1];
stored[0] = { own: true }.own;
stored[1] = "text";
show("stored", new Map([stored]));
const reversed = ["a", 1];
reversed.reverse();
show("reverse", new Map([reversed]));
const sorted = [2, 1];
sorted.sort();
show("sort", new Map([sorted]));
const emptied = ["a", 1];
emptied.length = 0;
show("length", new Map([emptied]));
const deleted = ["a", 1];
delete deleted[1];
show("delete", new Map([deleted]));
const spliced = ["a", 1];
spliced.splice(0, 1, "x", "y");
show("splice", new Map([spliced]));
const filled = ["a", 1];
filled.fill(seed);
show("fill", new Map([filled]));
const copied = ["a", 1, 2];
copied.copyWithin(0, 1);
show("copyWithin", new Map([copied]));
function change(pair) { pair[1] = "changed in a function"; }
const handedOn = ["a", 1];
change(handedOn);
show("handed on", new Map([handedOn]));
const unknown = ["a", 1];
JSON.parse("[1]", function () { return this === unknown ? 0 : 1; });
Reflect.set(unknown, 1, "by Reflect");
show("Reflect", new Map([unknown]));
const assigned = ["a", 1];
Object.assign(assigned, ["b", "c"]);
show("assign", new Map([assigned]));
const later = ["a", 1];
const madeFirst = new Map([later]);
later[1] = "after";
show("after the Map", madeFirst);
const setLater = new Map([["a", 1]]);
setLater.set("b", "text");
setLater.set(7, { o: 1 }.o);
show("set later", setLater);
const list = [["a", 1], ["b", 2]];
list.push(["c", "text"]);
list[0] = [seed, seed];
show("a list that changes", new Map(list));
function sum(map) { let total = 0; for (const value of map.values()) total += value; return total; }
console.log(sum(new Map([["a", 2147483647], ["b", 2147483647]])), sum(new Map([["a", 0.5], ["b", 1]])));
const table = new Map([["a:b", 1], ["c:d", 2]]);
function look(name) { const found = table.get(name); return found === undefined ? -1 : found + 1; }
console.log(look("a:b"), look("x"), look("c:d"));
show("a file of pairs", new Map(pairsOfFile));
show("one list of many in a file", new Map([rowsOfFile[1].tags]));
console.log(rowsOfFile.map(row => row.tags[0] + "|" + row.tags[1]).join(" "), typeof rowsOfFile[2].tags[1]);
const read = [["a", 1], ["b", 2]];
const neverRead = [["p", "q"], [1, 2]];
show("of two tables, one", new Map(read));
console.log(neverRead[1][0] + neverRead[0][1], neverRead[0][0] + neverRead[1][1]);
function pairOf(key, value) { return [key, value]; }
const kept = pairOf("kept", seed);
show("made in a function", new Map([pairOf("a", 1), pairOf(2, "b")]));
console.log(kept[0], kept[1] === seed);
const found = [];
for (const name of ["x", "y"]) found.push([name, name.length + seed]);
show("pushed in a loop", new Map(found));
show("from a callback", new Map(["x", "yy"].map(name => [name, name.length])));
show("a Map of a Map", new Map(new Map([["a", 1], [2, "b"]])));
function steps(name, list) {
  const rows = [];
  for (const [key, value, third] of list) rows.push(typeof key + ":" + String(key) + "=" + typeof value + ":" + String(value) + "/" + String(third));
  console.log(name, rows.join(" "));
}
steps("written", [["a", 1], ["b", 2.5, "third"], [seed, "c"]]);
steps("too short", [["a"], [], ["b", 2]]);
const steppedPopped = ["a", 1];
steppedPopped.pop();
steps("popped", [steppedPopped]);
const steppedEmptied = ["a", 1];
steppedEmptied.length = 1;
steps("emptied", [steppedEmptied]);
const steppedStored = ["a", 1];
steppedStored[1] = "text";
steps("stored", [steppedStored]);
const steppedReversed = ["a", 1];
steppedReversed.reverse();
steps("reversed", [steppedReversed]);
const steppedDeleted = ["a", 1];
delete steppedDeleted[0];
steps("deleted", [steppedDeleted]);
steps("mixed", [["a", 1], "xy", new Set(["s", 2]), new Map([["m", 1]]).keys(), Object.entries({ e: 1 })[0]]);
for (const [key, value] of [["a", 1], ["b", 2]]) console.log(key.length + value);
let [first, second, third] = ["a", 1];
console.log(first, second, third);
const swapped = ["a", 1];
[swapped[0], swapped[1]] = [swapped[1], swapped[0]];
const [left, right] = swapped;
console.log(typeof left, typeof right);
const [outer, [inner, last]] = ["a", [1, 2.5]];
console.log(outer, inner + last);
const handed = ["a", 1];
(function (pair) { pair.push("more"); pair.shift(); })(handed);
const [afterFirst, afterSecond] = handed;
console.log(afterFirst, afterSecond);
function* made() { const [a, b] = yield ["a", 1]; return [b, a]; }
const stepper = made();
const [fromYield, fromYieldToo] = stepper.next().value;
console.log(fromYield, fromYieldToo, stepper.next(["x", 2]).value);
`;

test("a Map made from pairs that the program writes", async () => {
  const folder = String(
    tempDir("aot-map-of-pairs", {
      "main.js": program,
      "pairs.json": `[["a", 1], ["b", "text"], ["c", [1, 2]], [4, null]]`,
      "rows.json": `[{ "tags": ["a", "b0"] }, { "tags": ["x", 5] }, { "tags": ["y", true, "more"] }]`,
      "tsconfig.json": "{}\n",
    }),
  );
  const run = async (...command: string[]) => {
    await using child = Bun.spawn({ cmd: command, cwd: folder, env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    return { stdout, stderr, exitCode };
  };
  const plain = await run(bunExe(), "run", "./main.js");
  expect(plain.exitCode).toBe(0);
  const built = await run(bunExe(), "build", "--compile", "--aot", "./main.js", "--outfile", "program");
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  expect(await run(join(folder, "program"))).toEqual(plain);
});
