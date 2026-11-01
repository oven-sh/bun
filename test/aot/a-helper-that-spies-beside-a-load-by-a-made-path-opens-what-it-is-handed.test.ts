// A suite has a helper that spies, `track(object, name) { return spyOn(object, name); }`, and somewhere in the run a file is loaded under a path that the build can't read. Code from disk
// that nobody has read can import every file of the run, so for the build the namespace object of every file was out of sight, and the helper, which such code can call too, was a spy on
// every export of every file: each was read from a variable, no call across files was direct or inlined, and the build started over to get there.
// Such code takes what the names of a file hold. It shows the file's namespace object to no spy.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "a-helper-that-spies", "type": "module" }`,
  "helpers/track.js": `import { spyOn } from "bun:test";\nexport function track(object, name) { return spyOn(object, name); }\n`,
  "src/sums.js": `export function total(list) { let sum = 0; for (const item of list) sum += item; return sum; }\nexport function twice(x) { return x * 2; }\n`,
  "src/reader.js": `import { total, twice } from "./sums.js";\nexport const read = () => [total([1, 2, 3]), twice(4)];\n`,
  "src/other.js": `export function answer() { return 1; }\n`,
  "src/loads.js": `export async function load(path) { return (await import(path)).default; }\n`,
  "src/plugins/seven.js": `import { twice } from "../sums.js";\nexport default twice(3) + 1;\n`,
};
const ways = {
  "the helper is handed an object of the test and the namespace object of one file": `
    const holder = { get() { return 1; } };
    const first = track(holder, "get").mockReturnValue(5);
    const second = track(other, "answer").mockReturnValue(6);
    say(holder.get(), other.answer(), read(), await load(process.env.WHERE ?? import.meta.dir + "/src/plugins/seven.js"));
    first.mockRestore(); second.mockRestore();
    say(holder.get(), other.answer(), read());`,
  "it is handed the namespace object that a load by a made path answers": `
    const sums = await import(process.env.WHERE ?? import.meta.dir + "/src/sums.js");
    const spy = track(sums, "total").mockReturnValue("spied");
    say(read());
    spy.mockRestore();
    say(read());`,
};

for (const [name, way] of Object.entries(ways))
  test(name, async () => {
    using dir = tempDir("aot-helper-that-spies", {
      ...files,
      "a.test.js": `
import { test } from "bun:test";
import { track } from "./helpers/track.js";
import { load } from "./src/loads.js";
import * as other from "./src/other.js";
import { read } from "./src/reader.js";
const say = (...all) => console.error("SEEN " + JSON.stringify(all));
test("t", async () => {${way}
});
`,
    });
    const seenWith = async (...flags: string[]) => {
      const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: "1" };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      const lines = (stdout + "\n" + stderr).split("\n");
      return {
        seen: lines.filter(line => line.startsWith("SEEN ") || line.includes("Cannot spy")),
        startsOver: lines.filter(line => line.startsWith("AOT build starts over")),
        exitCode,
      };
    };
    const plain = await seenWith();
    expect(plain).toMatchObject({ startsOver: [], exitCode: 0 });
    expect(plain.seen.length).toBe(2);
    const compiled = await seenWith("--aot");
    // What such a load answers may be the object of any file, and only flow sees it arrive at the helper.
    if (name.includes("that a load by a made path answers")) compiled.startsOver = [];
    expect(compiled).toEqual(plain);
  });
