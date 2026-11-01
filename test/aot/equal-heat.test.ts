// An object that nobody can follow is expected to have one of the layouts that have the names it is asked for. Where too many have them, those that are made most often are kept.
// How often is an estimate: a sum of products over the whole program, whose last digits follow the order of the sums. Here two layouts are made equally often, whatever the estimate
// is: each place that makes the one has a twin of the same form that makes the other. The twins stand in the opposite order, so one sum is (x + y) + z and the other (z + y) + x.
// The two count as equal, and the one that the program names first is kept. The counts are exact: no clock and no machine decides them.
import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { slot } from "./harness/commands";
import { buildCounted, countScript } from "./harness/counted-run";
import { test } from "./supported";

// A chain of functions: each calls the next inside so many loops, and the last one runs `body`. Every loop runs once.
const chain = (name: string, loops: number[], body: string) =>
  loops
    .map((count, link) => {
      const heads = Array.from({ length: count }, (_, i) => `for (let i${i} = 0; i${i} < once; i${i}++) `).join("");
      return `function ${name}${link}() { ${heads}${link + 1 < loops.length ? `${name}${link + 1}();` : body} }`;
    })
    .join("\n");

const forms = [
  [3, 4, 4, 4, 4, 4, 4],
  [4, 4, 4, 4, 4, 2, 3],
  [4, 4, 4, 4, 4, 4],
];
const read = "object.tag";
const files = {
  "rounds.js": `
    const hide = value => JSON.parse("0", () => value);
    const once = hide(1);
    const made = [];
    ${forms.map((form, at) => chain(`first${at}_`, form, "made.push({ tag: 1, first: 1 });")).join("\n")}
    ${forms
      .toReversed()
      .map((form, at) => chain(`second${at}_`, form, "made.push({ tag: 2, second: 2 });"))
      .join("\n")}
    ${chain("often", [...forms[0], 2], "made.push({ tag: 3, often: 3 });")}
    ${chain("asOften", [...forms[0], 2], "made.push({ tag: 4, asOften: 4 });")}
    made.push({ tag: 5, seldom: 5 }, { tag: 6, asSeldom: 6 });
    function tagOf(object) {
      return ${read};
    }
    ${forms.map((_, at) => `first${at}_0(); second${at}_0();`).join(" ")} often0(); asOften0();
    const first = made.find(object => "first" in object);
    const units = Number(process.argv[2]);
    let sum = 0;
    for (let unit = 0; unit < units; unit++) sum += tagOf(hide(first));
    console.log(sum === units && made.length === 10 ? "ok" : "no");
  `,
};

test(
  "of two layouts that are made equally often the first is expected",
  () =>
    slot(async () => {
      using dir = tempDir("aot-equal-heat", files);
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n", {
        warmUp: 2,
        units: 10,
      });
      const tests = [...work.tests, ...work.uneven].filter(
        counted => counted.kind === "TypeTest" && counted.position === files["rounds.js"].indexOf(read),
      );
      // A renamed test would count nothing.
      expect(tests.map(counted => ({ executed: counted.executed, failed: counted.failed }))).toEqual([
        { executed: 1, failed: 0 },
      ]);
    }),
  300_000,
);
