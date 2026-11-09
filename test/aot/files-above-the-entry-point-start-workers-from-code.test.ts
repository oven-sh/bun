// A file above the folder of the entry point lies at /$bunfs/_.._/../<rest> in an executable, with one `_.._` more than there are folders between it and the highest file of the program: a `..` in a URL or in
// path.join() leads one folder up, as on disk. How deep that goes is known when the last file is found. One thing needs it sooner: the code of a Worker (a data: URL, a Blob, an evaluated text) that holds the
// path of its own file, because a Worker starts by that text, and the build has to know the text to compile it. And such code leads to files of its own, which may lie higher than all that was found before.
// The rule: the build follows such code as it would read if the folders went up to the root of the disk, where no climb leaves them. When nothing is left to find it knows the depth, puts that code aside,
// and the program holds the code as it reads at that depth.
//
// The family is drawn, not picked. Every program is built by itself and prints what `bun main.mjs` prints.
//   level   how many folders above the entry point's the holder lies: the file that starts a Worker from code which holds the file's own path
//   reach   what that code leads to, and nothing else leads there:
//             sibling   a file beside the holder
//             hoisted   through it a package in the node_modules one folder above the holder
//             climbs    through it a file one folder above the holder, which starts ../up.mjs by a URL: two folders above the holder
//             joins     the code itself starts that up.mjs, under path.join(import.meta.dirname, "..", "..", "..", "up.mjs"): the `..` are gone from the text
//           In the last two the entry point starts its own ../up.mjs, so /$bunfs/up.mjs, which is left of a climb out of too few folders, is a path of the program.
//           A holder in the folder of the entry point does not join: two `..` out of /$bunfs/root leave nothing of it, which is another matter.
//   when    the own path stands on its own in the source, and the build follows it at once | it stands only inside the longer text
//   copies  one holder | the same source one folder higher too, both imported by the entry point | the second is reached only through the code of a Worker in a file that only the first's code leads to
//   kind    how the code is handed to the Worker. It is no sixth side of the family: the three kinds take turns over the others
import { expect } from "bun:test";
import { readFileSync, realpathSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, withoutDebugInformation } from "./harness/commands";
import { compileCommand, runtimeEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

const chain = ["a6", "a5", "a4", "a3", "a2", "a1", "app"];
const folder = (level: number) => chain.slice(0, chain.length - level).join("/");
const listen = `const listen = worker => new Promise(done => {
  worker.onmessage = event => (worker.terminate(), done(event.data));
  worker.onerror = event => (event.preventDefault(), worker.terminate(), done("error"));
});
`;
const kinds = {
  "data: URL": [listen, `new Worker("data:text/javascript," + encodeURIComponent(code))`, "postMessage"],
  "Blob": [
    listen,
    `new Worker(URL.createObjectURL(new Blob([code], { type: "application/javascript" })))`,
    "postMessage",
  ],
  "evaluated": [
    `import { Worker as Thread } from "node:worker_threads";
const listen = worker => new Promise(done => {
  worker.on("message", said => (worker.terminate(), done(said)));
  worker.on("error", () => (worker.terminate(), done("error")));
});
`,
    `new Thread(code, { eval: true })`,
    `require("node:worker_threads").parentPort.postMessage`,
  ],
};
type Kind = keyof typeof kinds;
type Reach = "sibling" | "hoisted" | "climbs" | "joins";

/** A module that starts a Worker from code which imports `name`, a file below the folder of the module, and posts what `call` makes of it. With `joins` the code then starts up.mjs, three `..` from that folder. */
function startFromCode(kind: Kind, when: "early" | "late", name: string, call: string, joins = false) {
  const [listen, worker, post] = kinds[kind];
  const paths = {
    file: `import.meta.dirname + "${name}"`,
    up: `path.join(import.meta.dirname, "..", "..", "..", "up.mjs")`,
  };
  const early = Object.entries(paths).map(([name, path]) => `const ${name} = ${path};\n`);
  const { file, up } = when === "early" ? { file: "file", up: "up" } : paths;
  const inner = `.then(said => new Promise(done => { const inner = new Worker("' + ${up} + '"); inner.onmessage = event => done(said + " > " + event.data); inner.onerror = () => done(said + " > error"); }))`;
  return `import path from "node:path";
${listen}${when === "early" ? early.join("") : ""}const code = 'import("' + ${file} + '").then(${call})${joins ? inner : ""}.then(said => ${post}(said), error => ${post}("threw " + error.name))';
export const start = () => listen(${worker});
`;
}

function draw(level: number, reach: Reach, when: "early" | "late", copies: string, kind: Kind) {
  const files: Record<string, string> = {};
  const holder = (at: number, more = "") => {
    const climb = reach === "climbs" ? ` + " > " + (await (await import("../../step.mjs")).start())` : "";
    const pad = reach === "hoisted" ? `import pad from "pad";\n` : "const pad = text => text;\n";
    files[`${folder(at)}/lib/starts.mjs`] = startFromCode(
      kind,
      when,
      "/job.mjs",
      "job => job.say()",
      reach === "joins",
    );
    files[`${folder(at)}/lib/job.mjs`] =
      `${pad}export const say = async () => pad("job at level ${at}")${climb}${more};\n`;
    if (reach === "climbs")
      files[`${folder(at + 1)}/step.mjs`] =
        `${listen}export const start = () => listen(new Worker(new URL("../up.mjs", import.meta.url)));\n`;
    if (startsUp) files[`${folder(at + 2)}/up.mjs`] = `postMessage("up at level ${at + 2}");\n`;
  };
  const startsUp = reach === "climbs" || reach === "joins";
  if (reach === "hoisted") {
    files[`${folder(level + 1)}/node_modules/pad/package.json`] =
      `{ "name": "pad", "type": "module", "main": "index.js" }\n`;
    files[`${folder(level + 1)}/node_modules/pad/index.js`] = `export default text => "[" + text + "]";\n`;
  }
  if (copies !== "one") holder(level + 1);
  holder(level, copies === "behind" ? ` + " > " + (await (await import("../../high.mjs")).start())` : "");
  if (copies === "behind")
    files[`${folder(level + 1)}/high.mjs`] = startFromCode(kind, "late", "/lib/starts.mjs", "it => it.start()");
  if (startsUp) files[`${folder(1)}/up.mjs`] = `postMessage("up at level 1");\n`;
  const up = "../".repeat(level) || "./";
  const said = [
    ...(startsUp ? [`await listen(new Worker(new URL("../up.mjs", import.meta.url)))`] : []),
    "await near()",
    ...(copies === "two" ? ["await far()"] : []),
  ];
  files[`${folder(0)}/main.mjs`] = `${listen}import { start as near } from "${up}lib/starts.mjs";
${copies === "two" ? `import { start as far } from "${up}../lib/starts.mjs";\n` : ""}console.log(${said.join(`, "|", `)});\n`;
  return files;
}

describe("compile/aot/files above the entry point start Workers from code", () => {
  // On Windows the path of a file holds backslashes, and the string literal in the code takes them for escapes, under plain Bun too.
  const drawn = isWindows ? test.skip : test.concurrent;
  const inFull = ["early one", "late one", "late two", "late behind"];
  let turn = 0;
  for (const level of [0, 1, 2, 3])
    for (const reach of ["sibling", "hoisted", "climbs", "joins"] as const)
      for (const side of level === 1 || level === 2 ? inFull : ["late one", "late behind"]) {
        if (level === 0 && reach === "joins") continue;
        const [when, copies] = side.split(" ") as ["early" | "late", string];
        // The kinds take turns, and each three programs begin one kind further on: so each kind meets each of the other sides.
        const kind = (Object.keys(kinds) as Kind[])[(turn + Math.floor(turn++ / 3)) % 3];
        drawn(`level ${level}, ${reach}, ${when}, ${copies}, ${kind}`, async () => {
          using project = tempDir("aot-workers-from-code-above", draw(level, reach, when, copies, kind));
          const app = join(String(project), folder(0));
          const executable = join(app, isWindows ? "program.exe" : "program");
          const [plain, compiled] = await slot(async () => {
            const plain = await spawned([bunExe(), "main.mjs"], app, bunEnv);
            const flags = [...withoutDebugInformation(), "./main.mjs", "--outfile", executable];
            built(await spawned([bunExe(), ...compileCommand, ...flags], app, bunEnv));
            const env = { ...bunEnv, [runtimeEnvironment.forbidsInterpreter]: "1" };
            return [plain, await spawned([executable], app, env)];
          });
          expect(plain.stdout).toInclude(`job at level ${level}`);
          expect(plain.stdout).not.toMatch(/error|threw/);
          expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
            stdout: plain.stdout,
            exitCode: 0,
          });
        });
      }

  // What the code names by the path of its file is found as any path is: with the extensions that a name may lack, and one file behind a link is one module.
  test.skipIf(isWindows)(
    "the code imports a name without its extension, and a file through a linked folder",
    async () => {
      const both = `Promise.all([import("' + import.meta.dirname + '/link/count"), import("' + import.meta.dirname + '/user.mjs")])`;
      using project = tempDir("aot-workers-from-code-above", {
        "app/main.mjs": `import { start } from "../lib/starts.mjs";\nconsole.log(await start());\n`,
        "lib/starts.mjs": `${listen}const code = '${both}.then(([direct, user]) => postMessage(direct.bump() + " " + user.bump()), error => postMessage("threw " + error.name))';
export const start = () => listen(${kinds["data: URL"][1]});\n`,
        "lib/user.mjs": `export { bump } from "./link/count.mjs";\n`,
        "real/count.mjs": "let count = 0;\nexport const bump = () => ++count;\n",
      });
      symlinkSync("../real", join(String(project), "lib/link"), "dir");
      const app = join(String(project), "app");
      const flags = [...withoutDebugInformation(), "./main.mjs", "--outfile", "program"];
      built(await slot(() => spawned([bunExe(), ...compileCommand, ...flags], app, bunEnv)));
      const env = { ...bunEnv, [runtimeEnvironment.forbidsInterpreter]: "1" };
      expect((await spawned([bunExe(), "main.mjs"], app, bunEnv)).stdout).toBe("1 2\n");
      expect((await spawned([join(app, "program")], app, env)).stdout).toBe("1 2\n");
    },
  );

  // The depth counts how high a name climbs, not only where files lie. The path of the Worker goes three folders up and comes back down by the names of two of them, so no file lies as high as it climbs:
  // out of too few folders /$bunfs/apps/cli/lib/job.mjs was left of it, which is the path of the file that the entry point starts.
  test.skipIf(isWindows)(
    "a file above the entry point joins a path that climbs higher than any file and comes back down",
    async () => {
      using project = tempDir("aot-workers-from-code-above", {
        "apps/cli/src/main.mjs": `import { listen, start } from "../lib/holder.mjs";
console.log(await listen(new Worker(new URL("../apps/cli/lib/job.mjs", import.meta.url))), "|", await start());\n`,
        "apps/cli/lib/holder.mjs": `import path from "node:path";
export ${listen}export const start = () => listen(new Worker(path.join(import.meta.dirname, "..", "..", "..", "apps", "cli", "lib", "job.mjs")));\n`,
        "apps/cli/lib/job.mjs": `postMessage("job");\n`,
        "apps/cli/apps/cli/lib/job.mjs": `postMessage("another job");\n`,
      });
      const app = join(String(project), "apps/cli/src");
      const flags = [...withoutDebugInformation(), "./main.mjs", "--outfile", "program"];
      built(await slot(() => spawned([bunExe(), ...compileCommand, ...flags], app, bunEnv)));
      const env = { ...bunEnv, [runtimeEnvironment.forbidsInterpreter]: "1" };
      expect((await spawned([bunExe(), "main.mjs"], app, bunEnv)).stdout).toBe("another job | job\n");
      expect((await spawned([join(app, "program")], app, env)).stdout).toBe("another job | job\n");
    },
  );

  // A `..` at the root of the disk leads nowhere, so a climb may count more of them than there are folders. Where a name climbs so high the folders of the executable go as deep as those
  // that the build follows the code in. They went one less deep, and two `..` too many left them: the file was found at one depth and not at the other, and the build stopped at an internal error.
  test.skipIf(isWindows)(
    "the code names a file by a climb past the root of the disk that comes back down",
    async () => {
      using project = tempDir("aot-workers-from-code-above", {
        "app/src/main.mjs": `import { start } from "../holder.mjs";\nconsole.log(await start());\n`,
        "job.mjs": `export const said = "job";\n`,
      });
      const root = realpathSync(String(project));
      const climb = Array(join(root, "app").split("/").length + 1).fill("..");
      const names = [
        `path.join(import.meta.dirname, ${climb.map(it => `"${it}"`).join(", ")}, "${root.slice(1)}", "job.mjs")`,
        `new URL("${climb.join("/")}${root}/job.mjs", import.meta.url)`,
      ];
      writeFileSync(
        join(root, "app/holder.mjs"),
        `import path from "node:path";
${listen}const code = 'Promise.all([import("' + ${names[0]} + '"), import("' + ${names[1]} + '")]).then(both => postMessage(both.map(it => it.said).join()), error => postMessage("threw " + error.name))';
export const start = () => listen(${kinds["data: URL"][1]});\n`,
      );
      const app = join(root, "app/src");
      const flags = [...withoutDebugInformation(), "./main.mjs", "--outfile", "program"];
      built(await slot(() => spawned([bunExe(), ...compileCommand, ...flags], app, bunEnv)));
      const env = { ...bunEnv, [runtimeEnvironment.forbidsInterpreter]: "1" };
      expect((await spawned([bunExe(), "main.mjs"], app, bunEnv)).stdout).toBe("job,job\n");
      expect((await spawned([join(app, "program")], app, env)).stdout).toBe("job,job\n");
    },
  );

  // What the build follows reads as deep as the disk goes. None of it is in the executable.
  test.skipIf(isWindows)("the executable is the same however deep the project lies on disk", async () => {
    const hashes: (number | bigint)[] = [];
    for (const above of ["", "x/y/z/"]) {
      const files = Object.entries(draw(1, "joins", "late", "behind", "data: URL"));
      using project = tempDir(
        "aot-workers-from-code-above",
        Object.fromEntries(files.map(it => [above + it[0], it[1]])),
      );
      const app = join(String(project), above, folder(0));
      const flags = [...withoutDebugInformation(), "./main.mjs", "--outfile", "program"];
      built(await slot(() => spawned([bunExe(), ...compileCommand, ...flags], app, bunEnv)));
      hashes.push(Bun.hash(readFileSync(join(app, "program"))));
    }
    expect(hashes[0]).toBe(hashes[1]);
  });
});
