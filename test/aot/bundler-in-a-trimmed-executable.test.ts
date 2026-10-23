import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, slot, spawned, unsupported } from "./run-programs";

type Completeness = "Complete" | "Incomplete";

const prelude = `const printResult = result => console.log(result.success, result.outputs.map(output => output.kind + " " + output.loader).join());\nconst directory = process.cwd() + "/";\n`;
const sources = {
  "entry.ts": `import { double } from "./helper";\nexport const answer: number = double(21);\nconsole.log(answer);\n`,
  "helper.ts": `export function double(x: number): number { return x * 2; }\n`,
  "style.css": `.a { color: red; & .b { margin: calc(1px + 2px); } }\n`,
  "page.tsx": `import "./style.css";\nexport function Page({ name }: { name: string }) { return <div className="a">{name}</div>; }\n`,
  "macro.ts": `export function doubled() { return "doubled " + [1, 2].map(x => x * 2).join(); }\n`,
  "calls-macro.ts": `import { doubled } from "./macro.ts" with { type: "macro" };\nconsole.log(doubled());\n`,
  "index.html": `<html><head><link rel="stylesheet" href="./style.css"><script type="module" src="./client.ts"></script></head><body></body></html>\n`,
  "client.ts": `document.body.textContent = "ready" as string;\n`,
};
const programs: Record<string, { source: string; untrimmed: string; trimmed?: string; runsUnseenCode?: string }> = {
  "Bun.build of a file": {
    source: `${prelude}const result = await Bun.build({ entrypoints: [directory + "entry.ts"], target: "bun" });\nprintResult(result);\nconsole.log((await result.outputs[0].text()).includes("x * 2"));\n`,
    untrimmed: "true entry-point ts\ntrue\n",
    runsUnseenCode: "Bun.build",
  },
  "build imported from bun: a component and its style sheet, minified": {
    source: `import { build } from "bun";\n${prelude}printResult(await build({ entrypoints: [directory + "page.tsx"], target: "browser", external: ["react", "react/jsx-dev-runtime", "react/jsx-runtime"], minify: true }));\n`,
    untrimmed: "true entry-point tsx,asset tsx\n",
    runsUnseenCode: "Bun.build",
  },
  "Bun.build with the React Compiler": {
    source: `${prelude}const result = await Bun.build({ entrypoints: [directory + "page.tsx"], target: "browser", reactCompiler: true, external: ["react", "react/compiler-runtime", "react/jsx-dev-runtime", "react/jsx-runtime"] });\nprintResult(result);\nconst text = await result.outputs[0].text();\nconsole.log(text.includes("react/compiler-runtime"), /\\b_c\\(\\d+\\)/.test(text));\n`,
    untrimmed: "true entry-point tsx,asset tsx\ntrue true\n",
    runsUnseenCode: "Bun.build",
  },
  "Bun.build with a plugin": {
    source: `${prelude}const result = await Bun.build({ entrypoints: [directory + "entry.ts"], target: "bun", plugins: [{ name: "triple", setup(builder) { builder.onLoad({ filter: /helper\\.ts$/ }, () => ({ contents: "export function double(x) { return x * 3; }", loader: "js" })); } }] });\nprintResult(result);\nconsole.log((await result.outputs[0].text()).includes("x * 3"));\n`,
    untrimmed: "true entry-point ts\ntrue\n",
    runsUnseenCode: "Bun.build",
  },
  "Bun.build of a file that calls a macro whose file is not in the executable: the build fails and the program continues":
    {
      source: `${prelude}printResult(await Bun.build({ entrypoints: [directory + "calls-macro.ts"], target: "bun", throw: false }));\nconsole.log("continues");\n`,
      untrimmed: "false \ncontinues\n",
      runsUnseenCode: "Bun.build",
    },
  "Bun.serve with an imported HTML file as a route": {
    source: `import page from "./index.html";
const server = Bun.serve({ port: 0, routes: { "/": page, "/api": () => new Response("x") } });
const assets = [];
for (const path of ["/", "/api"]) {
  const response = await fetch(new URL(path, server.url));
  console.log(path, response.status, response.headers.get("content-type"));
  for (const match of (await response.text()).matchAll(/(?:src|href)="([^"]+)"/g)) assets.push(match[1]);
}
for (const path of assets) {
  const response = await fetch(new URL(path, server.url));
  console.log(response.status, response.headers.get("content-type"), (await response.text()).length > 0);
}
server.stop(true);
`,
    untrimmed:
      "/ 200 text/html;charset=utf-8\n/api 200 text/plain;charset=utf-8\n200 text/css;charset=utf-8 true\n200 text/javascript;charset=utf-8 true\n",
  },
  "Bun.Transpiler": {
    source: `const transpiler = new Bun.Transpiler({ loader: "tsx" });\nconsole.log(transpiler.transformSync("const x: number = 1; export default x;").trim());\nconsole.log(JSON.stringify(transpiler.scanImports("import a from 'a'; import('b');")));\n`,
    untrimmed: `const x = 1;\nexport default x;\n[{"kind":"import-statement","path":"a"},{"kind":"dynamic-import","path":"b"}]\n`,
    runsUnseenCode: "Bun.Transpiler",
  },
};

const env = { ...bunEnv, NO_COLOR: "1" };

function findCompleteness(report: string): Completeness | undefined {
  if (/^aot: trim: blocked by /m.test(report)) return "Incomplete";
  return /^aot: trim: the compiler can see every API this program uses$/m.test(report) ? "Complete" : undefined;
}

function builtinsThatRunUnseenCode(report: string): string[] {
  return Array.from(report.matchAll(/^aot: trim: blocked by runtime-code: [^(\n]*\(([^)\n]*)\)/gm), match => match[1]);
}

// No program here names this member of Date.prototype, so the report lists it only when it lists every member of every built-in class.
function usesEveryMember(report: string): boolean {
  return /^aot: trim: uses property toTemporalInstant$/m.test(report);
}

(canTrim && !unsupported && !isWindows ? describe.concurrent : describe.skip)(
  "Bun.build, HTML routes and Bun.Transpiler in a trimmed executable",
  () => {
    for (const [name, { source, untrimmed, trimmed = untrimmed, runsUnseenCode }] of Object.entries(programs)) {
      test(
        name,
        () =>
          slot(async () => {
            using dir = tempDir("bundler", { "program.mjs": source, ...sources });
            const folder = String(dir);
            const found: Record<string, unknown> = {};
            for (const [kind, flags] of [
              ["untrimmed", []],
              ["trimmed", ["--trim"]],
            ] as const) {
              const build = await spawned(
                [bunExe(), "build", "--compile", "--aot", "--explain=trim", ...flags, "program.mjs", "--outfile", kind],
                folder,
                env,
              );
              built(build);
              const ran = await spawned([join(folder, kind)], folder, env);
              const openedBy = builtinsThatRunUnseenCode(build.stderr).filter(builtin => builtin === runsUnseenCode);
              found[kind] = {
                completeness: findCompleteness(build.stderr),
                openedBy,
                usesEveryMember: usesEveryMember(build.stderr),
                stdout: ran.stdout,
                exitCode: ran.exitCode,
              };
            }
            const report =
              runsUnseenCode === undefined
                ? { completeness: "Complete", openedBy: [], usesEveryMember: false, exitCode: 0 }
                : { completeness: "Incomplete", openedBy: [runsUnseenCode], usesEveryMember: true, exitCode: 0 };
            expect(found).toEqual({
              untrimmed: { ...report, stdout: untrimmed },
              trimmed: { ...report, stdout: trimmed },
            });
          }),
        600_000,
      );
    }
  },
);
