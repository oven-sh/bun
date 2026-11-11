import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { limitOfARun, limitWithASAN, slot, slots } from "./harness/commands";
import { run } from "./harness/run";
import { test, testOneByOne } from "./supported";

// Every small graph of one kind, none drawn. holder.mjs stars two ways that both bring `round`. One way is a chain of one to three hops, each a statement (s), a statement
// under a new name (r) or a star (t), that ends in a mocked file; the other is a file of its own. The mocked file has the name itself, by a statement or a star from below,
// or by a star or a statement back into the way, which makes a ring. The mock has the name, lacks it or takes the original. The cases of one kind of mocked file are laid
// as one project: one plain run and one compiled run of it, at the same time. What `bun test` prints is the specification.
// Each case says three things, and each is judged by itself: the keys and values of the holder's namespace, whether a spread of it survives, and a named import.
// mock-ways.known.txt holds a line for each chain and each kind of mocked file: three marks for each of the twelve cases of `marked` below, in that order: `.` as `bun test`,
// `S` something else is printed in silence, `L` an error is printed or nothing. A mark that changes fails. BUN_AOT_REWRITE_MOCK_WAYS=1 writes the list anew.
const hopsOfDepth = (depth: number): string[] =>
  depth ? hopsOfDepth(depth - 1).flatMap(hops => ["s", "r", "t"].map(hop => hops + hop)) : [""];
const chains = [1, 2, 3].flatMap(hopsOfDepth);
const kinds = ["own", "statement-below", "star-below", "ring-by-a-star", "ring-by-a-statement"] as const;
const marked = ["has", "lacks", "original"].flatMap(mock =>
  ["first", "last"].flatMap(order => ["mjs", "cjs"].map(other => ({ mock, order, other }))),
);
type Kind = (typeof kinds)[number];

const nameOf = (chain: string, kind: Kind, { mock, order, other }: (typeof marked)[number]) =>
  `${chain}--${kind}--${mock}--${order}--${other}`;
const casesOf = (kind: Kind) => chains.flatMap(chain => marked.map(which => nameOf(chain, kind, which)));

// A project for each kind, and not one for all: the runs of five projects go beside one another, and in each run a test file takes the longer the more test files ran before it
// in the same process.
function projectOf(kind: Kind) {
  const files: Record<string, string> = {
    "package.json": `{ "name": "every-way-to-a-mocked-file", "type": "module" }`,
  };
  for (const chain of chains) {
    for (const which of marked) {
      const at = `c/${nameOf(chain, kind, which)}`;
      let name = "round";
      [...chain].forEach((hop, index) => {
        const next = index + 1 < chain.length ? `w${index + 2}.mjs` : "mocked.mjs";
        const below = hop !== "r" ? name : name === "round" ? "spare" : "round";
        files[`${at}/w${index + 1}.mjs`] =
          hop === "t" ? `export * from "./${next}";\n` : `export { ${below} as ${name} } from "./${next}";\n`;
        name = below;
      });
      files[`${at}/below.mjs`] = `export const ${name} = "below";\n`;
      files[`${at}/real.mjs`] = `export const ${name} = "real";\n`;
      files[`${at}/mocked.mjs`] =
        {
          "own": `export const ${name} = "own";\n`,
          "statement-below": `export { ${name} } from "./below.mjs";\n`,
          "star-below": `export * from "./below.mjs";\n`,
          "ring-by-a-star": `export * from "./w1.mjs";\nexport * from "./real.mjs";\n`,
          "ring-by-a-statement": `export { round as ${name} } from "./w1.mjs";\n`,
        }[kind] + `export const held = 1;\n`;
      files[`${at}/other.${which.other}`] =
        which.other === "mjs" ? `export const round = "other";\n` : `exports.round = "other";\n`;
      const stars = [`export * from "./w1.mjs";\n`, `export * from "./other.${which.other}";\n`];
      files[`${at}/holder.mjs`] =
        (which.order === "first" ? stars : stars.reverse()).join("") + `export const kept = 1;\n`;
      files[`${at}/named.mjs`] = `import { round } from "./holder.mjs";\nexport const look = () => round;\n`;
      const factory = {
        has: `() => ({ ${name}: "mock", held: 2 })`,
        lacks: `() => ({ held: 2 })`,
        original: `async original => ({ ...(await original()), held: 2 })`,
      }[which.mock];
      files[`t/${nameOf(chain, kind, which)}.test.js`] = `import { test, vi } from "bun:test";
vi.mock("../${at}/mocked.mjs", ${factory});
const tried = read => { try { return String(read()); } catch (error) { return error.name; } };
test("${nameOf(chain, kind, which)}", async () => {
  const words = [];
  try {
    const all = await import("../${at}/holder.mjs");
    words.push(Object.keys(all).map(key => key + "=" + tried(() => all[key])).join());
    words.push(tried(() => ({ ...all }) && "survives"));
  } catch (error) {
    words.push(error.name, error.name);
  }
  try {
    words.push(tried((await import("../${at}/named.mjs")).look));
  } catch (error) {
    words.push(error.name);
  }
  console.log("| ${nameOf(chain, kind, which)}:", words.join(" . "));
});
`;
    }
  }
  return files;
}

// A run that hangs is killed at its limit, and gives its slot back. A debug build of Bun builds one project for minutes.
const limit = isDebug ? 600_000 : isASAN ? limitWithASAN : limitOfARun;

/** Of a run that ended otherwise than it should: what it wrote besides the tests that passed, from both ends. A run that dies says why there, and nowhere else. */
function lastWordsOf(stderr: string) {
  const lines = stderr
    .split("\n")
    .filter(line => line && !/^(\(pass\) |t\/|  c\/)/.test(line))
    .map(line => line.slice(0, 200));
  return lines.length > 16 ? [...lines.slice(0, 8), "...", ...lines.slice(-8)] : lines;
}

/**
 * One run of a project, `bun test` or with `--aot` the compiled run: what each case printed, how the run ended, and how a run ends that printed as much.
 * It judges nothing and throws nothing: the test judges both of its runs together, once both are over, and throws what `run()` threw.
 */
async function ran(dir: string, cases: string[], ...flags: string[]) {
  // No test of the run has a shorter limit than the run: beside a build, a debug build of Bun takes longer for some cases than the five seconds of `bun test`.
  const command = [bunExe(), "test", ...flags, `--timeout=${limit}`, "./t"];
  const started = slot(() => run(command, dir, { ...bunEnv, NO_COLOR: "1" }, limit));
  // `run()` throws of a run that it ended for the memory that the runs held together. That is how this run ended then.
  const { stdout, stderr, exitCode, threw } = await started.then(
    over => ({ ...over, threw: [] as unknown[] }),
    (thrown: unknown) => ({ stdout: "", stderr: "", exitCode: -1, threw: [thrown] }),
  );
  const printed = [...stdout.matchAll(/^\| (\S+): (.*)$/gm)].map(([, name, words]) => [name, words] as const);
  const lines = new Map(printed);
  const count = (word: string) => Number(stderr.match(new RegExp(`^ *(\\d+) ${word}$`, "m"))?.[1]);
  const counted = { pass: count("pass"), fail: count("fail"), exitCode };
  // A test that comes to its end has printed its line, and passes. So what the run counts and how it ends follow from what it printed.
  const follows = { pass: lines.size, fail: cases.length - lines.size, exitCode: lines.size === cases.length ? 0 : 1 };
  const asked = command.slice(1).join(" ");
  const notOnce = printed
    .map(([name]) => name)
    .filter((name, at, all) => !cases.includes(name) || all.indexOf(name) !== at);
  const lastWords = [...threw.map(String), ...(Bun.deepEquals(counted, follows) ? [] : lastWordsOf(stderr))];
  return {
    lines,
    threw,
    ended: { run: asked, notOnce, ...counted, lastWords },
    endsWell: { run: asked, notOnce: [], ...follows, lastWords: [] },
  };
}

const list = join(import.meta.dir, "mock-ways.known.txt");
const listed = () => readFileSync(list, "utf8").split("\n");
const marksIn = (lines: string[]) => lines.filter(line => line && !line.startsWith("#"));
const headOf = (line: string) => line.slice(0, line.indexOf(":"));
const rewrites = !!process.env.BUN_AOT_REWRITE_MOCK_WAYS;

// The kinds run beside one another, and each run takes a slot: no more of them run at once than the machine has processors.
// A run of a debug build of Bun holds a gigabyte: there the kinds run one by one.
const declare = isDebug ? testOneByOne : test.concurrent;
// The limit of a kind holds every run that may take a slot ahead of its own, each for its whole limit: all ten where the kinds run beside one another.
// So no kind times out while it waits for a slot, and a run that hangs is ended at its own limit, where the kind says which. A minute more to lay and to remove the project.
const limitOfAKind = Math.ceil((isDebug ? 2 : 2 * kinds.length) / slots) * limit + 60_000;

// A title is short. CI's runner reads the first hundred characters of `<title> — <error>`, and tries no file again where they say that `run()` ended
// the commands for the memory that they held together.
declare.each(kinds)(
  "each case of %s",
  async kind => {
    using dir = tempDir("aot-mock-ways", projectOf(kind));
    const cases = casesOf(kind);
    // Both runs are over before either is judged and before the project is removed: a failure shows both, and leaves no run behind in a folder that is gone.
    const [plain, compiled] = await Promise.all([ran(String(dir), cases), ran(String(dir), cases, "--aot")]);
    const threw = [...plain.threw, ...compiled.threw];
    if (threw.length) {
      // What `run()` threw goes on as it was thrown, for the runner to read. Both runs are shown in front of it.
      console.error([plain.ended, compiled.ended]);
      throw threw[0];
    }
    expect([plain.ended, compiled.ended]).toEqual([plain.endsWell, compiled.endsWell]);
    // The specification has every case.
    expect(cases.filter(name => !plain.lines.has(name))).toEqual([]);
    const found = chains.map(chain => {
      const marks = marked.map(which => {
        const got = compiled.lines.get(nameOf(chain, kind, which))?.split(" . ") ?? [];
        const expected = plain.lines.get(nameOf(chain, kind, which))!.split(" . ");
        return expected
          .map((words, at) => (got[at] === words ? "." : got[at] && !/Error/.test(got[at]) ? "S" : "L"))
          .join("");
      });
      return `${chain} ${kind}: ${marks.join(" ")}`;
    });
    if (rewrites) {
      // The kinds write one after another: nothing is awaited between the read and the write.
      const known = listed();
      const lineOf = new Map([...marksIn(known), ...found].map(line => [headOf(line), line]));
      const all = chains.flatMap(chain => kinds.flatMap(each => lineOf.get(`${chain} ${each}`) ?? []));
      writeFileSync(list, [...known.filter(line => line.startsWith("#")), ...all, ""].join("\n"));
      return;
    }
    expect(found).toEqual(marksIn(listed()).filter(line => headOf(line).endsWith(` ${kind}`)));
  },
  limitOfAKind,
);

// Each kind reads its own lines of the list. A line of no case would be read by none of them.
test("mock-ways.known.txt holds a line for each chain and each kind of mocked file, and no other", () => {
  // The kinds are writing the list anew, and a line of no case goes out with that.
  if (rewrites) return;
  expect(marksIn(listed()).map(headOf)).toEqual(chains.flatMap(chain => kinds.map(kind => `${chain} ${kind}`)));
});
