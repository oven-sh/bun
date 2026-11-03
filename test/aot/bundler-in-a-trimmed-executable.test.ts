import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { built, spawned, unsupported, withoutDebugInformation } from "./harness/commands";

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
const parts: Record<string, { source: string; printed: string; runsUnseenCode?: string }> = {
  "Bun.build of a file": {
    source: `const result = await Bun.build({ entrypoints: [directory + "entry.ts"], target: "bun" });\nprintResult(result);\nconsole.log((await result.outputs[0].text()).includes("x * 2"));\n`,
    printed: "true entry-point ts\ntrue\n",
    runsUnseenCode: "Bun.build",
  },
  "build imported from bun: a component and its style sheet, minified": {
    source: `import { build } from "bun";\nprintResult(await build({ entrypoints: [directory + "page.tsx"], target: "browser", external: ["react", "react/jsx-dev-runtime", "react/jsx-runtime"], minify: true }));\n`,
    printed: "true entry-point tsx,asset tsx\n",
    runsUnseenCode: "Bun.build",
  },
  "Bun.build with the React Compiler": {
    source: `const result = await Bun.build({ entrypoints: [directory + "page.tsx"], target: "browser", reactCompiler: true, external: ["react", "react/compiler-runtime", "react/jsx-dev-runtime", "react/jsx-runtime"] });\nprintResult(result);\nconst text = await result.outputs[0].text();\nconsole.log(text.includes("react/compiler-runtime"), /\\b_c\\(\\d+\\)/.test(text));\n`,
    printed: "true entry-point tsx,asset tsx\ntrue true\n",
    runsUnseenCode: "Bun.build",
  },
  "Bun.build with a plugin": {
    source: `const result = await Bun.build({ entrypoints: [directory + "entry.ts"], target: "bun", plugins: [{ name: "triple", setup(builder) { builder.onLoad({ filter: /helper\\.ts$/ }, () => ({ contents: "export function double(x) { return x * 3; }", loader: "js" })); } }] });\nprintResult(result);\nconsole.log((await result.outputs[0].text()).includes("x * 3"));\n`,
    printed: "true entry-point ts\ntrue\n",
    runsUnseenCode: "Bun.build",
  },
  "Bun.build of a file that calls a macro whose file is not in the executable: the build fails and the program continues":
    {
      source: `printResult(await Bun.build({ entrypoints: [directory + "calls-macro.ts"], target: "bun", throw: false }));\nconsole.log("continues");\n`,
      printed: "false \ncontinues\n",
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
    printed:
      "/ 200 text/html;charset=utf-8\n/api 200 text/plain;charset=utf-8\n200 text/css;charset=utf-8 true\n200 text/javascript;charset=utf-8 true\n",
  },
  "Bun.Transpiler": {
    source: `const transpiler = new Bun.Transpiler({ loader: "tsx" });\nconsole.log(transpiler.transformSync("const x: number = 1; export default x;").trim());\nconsole.log(JSON.stringify(transpiler.scanImports("import a from 'a'; import('b');")));\n`,
    printed: `const x = 1;\nexport default x;\n[{"kind":"import-statement","path":"a"},{"kind":"dynamic-import","path":"b"}]\n`,
  },
};

const env = { ...bunEnv, NO_COLOR: "1" };

function findCompleteness(report: string): Completeness | undefined {
  if (/^aot: trim: blocked by /m.test(report)) return "Incomplete";
  const isNotBlocked =
    /^aot: trim: the compiler (?:can see every API this program uses$|can't tell which API this program uses at )/m;
  return isNotBlocked.test(report) ? "Complete" : undefined;
}

function builtinsThatRunUnseenCode(report: string): string[] {
  return Array.from(report.matchAll(/^aot: trim: blocked by runtime-code: [^(\n]*\(([^)\n]*)\)/gm), match => match[1]);
}

// No program here names this member of Date.prototype, so the report lists it only when it lists every member of every built-in class.
function usesEveryMember(report: string): boolean {
  return /^aot: trim: uses property toTemporalInstant$/m.test(report);
}

// The parts that call Bun.build are one program, and the others another.
function programOf(runsUnseenCode: string | undefined) {
  const taken = Object.entries(parts).filter(([, part]) => part.runsUnseenCode === runsUnseenCode);
  const imports = /^import .*\n/gm;
  return {
    names: taken.map(([name]) => name).join("; "),
    source:
      taken.flatMap(([, { source }]) => source.match(imports) ?? []).join("") +
      prelude +
      taken.map(([, { source }]) => `{\n${source.replace(imports, "")}}\n`).join(""),
    printed: taken.map(([, { printed }]) => printed).join(""),
  };
}

(canTrim && !unsupported ? describe.concurrent : describe.skip)(
  "Bun.build, HTML routes and Bun.Transpiler in a trimmed executable",
  () => {
    for (const runsUnseenCode of ["Bun.build", undefined]) {
      const { names, source, printed } = programOf(runsUnseenCode);
      test(
        names,
        async () => {
          using dir = tempDir("bundler", { "program.mjs": source, ...sources });
          const folder = String(dir);
          const build = await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              "--explain=trim",
              "--trim",
              ...withoutDebugInformation(),
              "program.mjs",
              "--outfile",
              "trimmed",
            ],
            folder,
            env,
          );
          built(build);
          const ran = await spawned([join(folder, "trimmed")], folder, env);
          expect({
            completeness: findCompleteness(build.stderr),
            openedBy: [...new Set(builtinsThatRunUnseenCode(build.stderr))].filter(
              builtin => builtin === runsUnseenCode,
            ),
            usesEveryMember: usesEveryMember(build.stderr),
            stdout: ran.stdout,
            exitCode: ran.exitCode,
          }).toEqual({
            ...(runsUnseenCode === undefined
              ? { completeness: "Complete", openedBy: [], usesEveryMember: false }
              : { completeness: "Incomplete", openedBy: [runsUnseenCode], usesEveryMember: true }),
            stdout: printed,
            exitCode: 0,
          });
        },
        600_000,
      );
    }
  },
);
