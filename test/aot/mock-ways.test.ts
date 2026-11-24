import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// Every small graph of one kind, none drawn. holder.mjs stars two ways that both bring `round`. One way is a chain of one to three hops, each a statement (s), a statement
// under a new name (r) or a star (t), that ends in a mocked file; the other is a file of its own. The mocked file has the name itself, by a statement or a star from below,
// or by a star or a statement back into the way, which makes a ring. The mock has the name, lacks it or takes the original. All cases are laid as one project: one plain
// run and one compiled run. What `bun test` prints is the specification.
// Each case says three things, and each is judged by itself: the keys and values of the holder's namespace, whether a spread of it survives, and a named import.
// mock-ways.known.txt holds a line for each chain and each kind of mocked file: three marks for each of the twelve cases of `marked` below, in that order: `.` as `bun test`,
// `S` something else is printed in silence, `L` an error is printed or nothing. A mark that changes fails. BUN_AOT_REWRITE_MOCK_WAYS=1 writes the list anew.
const hopsOfDepth = (depth: number): string[] =>
  depth ? hopsOfDepth(depth - 1).flatMap(hops => ["s", "r", "t"].map(hop => hops + hop)) : [""];
const chains = [1, 2, 3].flatMap(hopsOfDepth);
const kinds = ["own", "statement-below", "star-below", "ring-by-a-star", "ring-by-a-statement"];
const marked = ["has", "lacks", "original"].flatMap(mock =>
  ["first", "last"].flatMap(order => ["mjs", "cjs"].map(other => ({ mock, order, other }))),
);

const files: Record<string, string> = { "package.json": `{ "name": "every-way-to-a-mocked-file", "type": "module" }` };
const nameOf = (chain: string, kind: string, { mock, order, other }: (typeof marked)[number]) =>
  `${chain}--${kind}--${mock}--${order}--${other}`;
for (const chain of chains) {
  for (const kind of kinds) {
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
}

async function said(dir: string, ...flags: string[]) {
  const { stdout, stderr } = await run([bunExe(), "test", ...flags, "./t"], dir, { ...bunEnv, NO_COLOR: "1" });
  const lines = new Map<string, string>();
  for (const line of (stdout + "\n" + stderr).split("\n")) {
    const found = line.match(/^\| (\S+): (.*)$/);
    if (found) lines.set(found[1], found[2]);
  }
  return lines;
}

const list = join(import.meta.dir, "mock-ways.known.txt");
const dir = tempDir("aot-mock-ways", files);
afterAll(() => dir[Symbol.dispose]());
test("what each case prints", async () => {
  const [plain, compiled] = [await said(String(dir)), await said(String(dir), "--aot")];
  expect(plain.size).toBe(chains.length * kinds.length * marked.length);
  const found = chains.flatMap(chain =>
    kinds.map(kind => {
      const marks = marked.map(which => {
        const got = compiled.get(nameOf(chain, kind, which))?.split(" . ") ?? [];
        const expected = plain.get(nameOf(chain, kind, which))!.split(" . ");
        return expected
          .map((words, at) => (got[at] === words ? "." : got[at] && !/Error/.test(got[at]) ? "S" : "L"))
          .join("");
      });
      return `${chain} ${kind}: ${marks.join(" ")}`;
    }),
  );
  const known = readFileSync(list, "utf8").split("\n");
  if (process.env.BUN_AOT_REWRITE_MOCK_WAYS) {
    writeFileSync(list, [...known.filter(line => line.startsWith("#")), ...found, ""].join("\n"));
    return;
  }
  expect(found).toEqual(known.filter(line => line && !line.startsWith("#")));
}, 600_000);
