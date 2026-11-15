// A build checks under a view of its own: with Bun's declarations where the project names none, with options that it forces, with every file a module.
// What it finds there stops it only if `bun check` finds an error at the same place under the project's own configuration and its own installed types.
// Which error a mistake gets depends on the types in sight (a suggestion, the number of overloads), so the codes may differ. That a name is not found says nothing of another error at its place.
// So each program here is asked twice: the places that the build reports are among those that `bun check` reports, and the build says what the row expects.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const env = { ...bunEnv, NO_COLOR: "1" };

type Row = { files: Record<string, string>; errors: string[]; stdout?: string };

const withoutTypes = (library: string) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      target: library,
      moduleResolution: "bundler",
      noEmit: true,
      types: [],
      lib: [library, "DOM"],
    },
    files: ["main.ts"],
  });

const scriptWithTypesOfBunInstalled = (more: string) => ({
  "main.ts": `/// <reference path="./shared.d.ts" />
class Crate {
  weight = 1;
}
enum Grade {
  Fine = 4,
}
function describe(grade: Grade): string {
  return grade + " " + Grade[grade];
}
console.log(new Crate().weight, new Crate().label, describe(Grade.Fine), describe(3));
${more}`,
  "shared.d.ts": `interface Crate {
  label?: string;
}
declare enum Grade {
  Coarse = 1,
  Middling = 3,
}
`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "preserve",
      target: "esnext",
      moduleDetection: "auto",
      noEmit: true,
      types: ["bun"],
    },
    files: ["main.ts"],
  }),
  "node_modules/@types/bun/package.json": `{ "name": "@types/bun", "version": "1.3.0", "types": "index.d.ts" }\n`,
  "node_modules/@types/bun/index.d.ts": `declare module "bun" {\n  export const version: string;\n}\n`,
});

// tsc reads the declarations of such a package, and a build reads the source. The project has not installed Bun's types.
const packageWithAotSource = (main: string, declarations: string, source: string) => ({
  "main.ts": main,
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, module: "preserve", target: "esnext", moduleResolution: "bundler", noEmit: true },
    files: ["main.ts"],
  }),
  "node_modules/made-up/package.json": `{ "name": "made-up", "version": "0.0.1", "exports": { ".": { "types": "./types.d.ts", "aot": "./code.ts", "default": "./code.ts" } } }\n`,
  "node_modules/made-up/types.d.ts": declarations,
  "node_modules/made-up/code.ts": source,
});
const joins = [
  `export declare function join(first: string | number, second: number): string;\n`,
  `export function join(first: string, second: number): string {\n  return first + ":" + second;\n}\n`,
] as const;

// Each package has a rootDir of its own, and one imports the source of the other: tsc says that the file isn't under rootDir (TS6059), which is about where it writes its output.
const packagesWithRootDirectories = (start: string) => {
  const config = JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "preserve",
      target: "esnext",
      moduleResolution: "bundler",
      rootDir: "src",
      outDir: "dist",
    },
    include: ["src"],
  });
  return {
    ...packageWithAotSource(`import "./packages/one/src/start";\n`, ...joins),
    "packages/one/tsconfig.json": config,
    "packages/two/tsconfig.json": config,
    "packages/one/src/start.ts": `import { join } from "made-up";\nimport { two } from "../../two/src/two";\n${start}`,
    "packages/two/src/two.ts": `export const two: number = 2;\n`,
  };
};

const rows: Record<string, Row> = {
  "a function of the program where `typeof fetch` is wanted: Bun's declarations add a member to fetch": {
    files: {
      "main.ts": `export {};
const canned = { ok: true } as unknown as Response;
async function answer(input: string | URL | Request): Promise<Response> {
  return canned;
}
async function load(get: typeof fetch): Promise<boolean> {
  const response = await get("http://localhost/");
  return response.ok;
}
load(answer).then(ok => console.log(ok));
`,
    },
    errors: [],
    stdout: "true\n",
  },
  "a member of import.meta that the program declares as Bun does, with another modifier": {
    files: {
      "main.ts": `declare global {
  interface ImportMeta {
    readonly dirname: string;
  }
}
console.log(typeof import.meta.dirname);
export {};
`,
    },
    errors: [],
    stdout: "string\n",
  },
  "a global that the program declares for itself and Bun declares too": {
    files: {
      "main.ts": `declare global {
  const process: { readonly argv: readonly string[] };
}
console.log(process.argv.length > 0);
export {};
`,
    },
    errors: [],
    stdout: "true\n",
  },
  "an error at a literal whose cause is a timer of Bun's, and one whose cause is the platform": {
    files: {
      "main.ts": `export {};
const id = setTimeout(() => console.log("rang"), 1);
console.log(typeof id.toString(36));
switch (navigator.platform) {
  case "Linux armv8l":
    console.log("arm");
    break;
  default:
    console.log("other");
}
`,
    },
    errors: [],
    stdout: "string\nother\nrang\n",
  },
  "a name of a script of the project that the entry point does not import": {
    files: {
      "tsconfig.json": "{}",
      "shared.ts": "var shared = 1;\n",
      "main.ts": `console.log(typeof shared);\n`,
    },
    errors: [],
    stdout: "undefined\n",
  },
  "a type that the project's own `lib` does not have": {
    files: {
      "tsconfig.json": `{ "compilerOptions": { "target": "es2019", "lib": ["dom", "es2019"] } }`,
      "main.ts": `declare function take<Wide, Narrow extends Wide>(): void;
export type Asked = typeof take<{ label?: string }, bigint>;
console.log("built");
`,
    },
    errors: [],
    stdout: "built\n",
  },
  "a mistake of the program in one statement with globals of Bun's": {
    files: {
      "main.ts": `export {};
interface Job {
  id: string;
  startedAt: number;
  retries: number;
}
const job: Job = { id: crypto.randomUUID(), startedAt: performance.now(), retries: "three" };
console.log(job.retries);
`,
    },
    errors: ["TS2322"],
  },
  "a mistake of the program inside an arrow function that logs": {
    files: {
      "main.ts": `export {};
const main = (): void => {
  const wrong: number = "text";
  console.log(wrong);
};
main();
`,
    },
    errors: ["TS2322"],
  },
  "a mistake of the program behind a callback whose parameter has no written type": {
    files: { "main.ts": `export {};\nconst labels: string[] = [1, 2].map(n => n * 2);\nconsole.log(labels);\n` },
    errors: ["TS2322"],
  },
  "a mistake of the program beside one that rests on Bun's declarations: the first alone is reported": {
    files: {
      "main.ts": `export {};
const id: number = setTimeout(() => {}, 1);
const wrong: number = "text";
console.log(typeof id, wrong);
`,
    },
    errors: ["TS2322"],
  },
  "a name that nothing declares": {
    files: { "main.ts": `export {};\nconsole.log(nowhere);\n` },
    errors: ["TS2304"],
  },
  "a misspelled member of import.meta: Bun's declarations have one to suggest": {
    files: { "main.ts": `console.log(import.meta.dirnam);\nexport {};\n`, "tsconfig.json": withoutTypes("ESNext") },
    errors: ["TS2551"],
  },
  "a misspelled member of a class of the web: Bun's declarations have one to suggest": {
    files: { "main.ts": `console.log(new Headers().toJSN);\nexport {};\n`, "tsconfig.json": withoutTypes("ESNext") },
    errors: ["TS2551"],
  },
  "a misspelled member of console, without a tsconfig.json": {
    files: { "main.ts": `console.wrte("x");\n` },
    errors: ["TS2551"],
  },
  "a misspelled method of a list: the library that the build reads has one to suggest, the project's older one has none":
    {
      files: {
        "main.ts": `const list: number[][] = [[1], [2]];\nconsole.log(list.flatt().length);\nexport {};\n`,
        "tsconfig.json": withoutTypes("ES2015"),
      },
      errors: ["TS2551"],
    },
  "a misspelled option of fetch: Bun's declarations have more than one overload": {
    files: {
      "main.ts": `const answer = fetch("http://127.0.0.1", { verbos: true });\nanswer.catch(() => {});\nexport {};\n`,
      "tsconfig.json": withoutTypes("ESNext"),
    },
    errors: ["TS2769"],
  },
  "a number handed to fetch, without a tsconfig.json": {
    files: { "main.ts": `fetch(1);\n` },
    errors: ["TS2769"],
  },
  "a misspelled namespace of Node.js": {
    files: {
      "main.ts": `let timer: NodeJs.Timer | undefined;\nconsole.log(timer);\nexport {};\n`,
      "tsconfig.json": withoutTypes("ESNext"),
    },
    errors: ["TS2833"],
  },
  "a type of the web read as a value, under a library without the DOM: Bun's declarations have the type, no view has a value":
    {
      files: {
        "main.ts": `const taken: unknown = RequestInit;\nconsole.log(typeof taken);\nexport {};\n`,
        "tsconfig.json": withoutTypes("ES2022").replace(`,"DOM"`, ""),
      },
      errors: ["TS2693"],
    },
  "a value of Node.js written where a type is wanted: `bun check` says only that the name is not declared": {
    files: { "main.ts": `let p: process;\nconsole.log(1);\nexport {};\n`, "tsconfig.json": withoutTypes("ESNext") },
    errors: [],
    stdout: "1\n",
  },
  "what Node.js may leave undefined is handed on as a string: `bun check` says only that the name is not declared": {
    files: {
      "main.ts": `function takes(text: string): number {\n  return text.length;\n}\nconsole.log(takes(process.env.PATH) > 0);\nexport {};\n`,
      "tsconfig.json": withoutTypes("ESNext"),
    },
    errors: [],
    stdout: "true\n",
  },
  "a script that merges with a declaration file: tsc accepts it; in a build every file is a module, as under `bun run`":
    {
      files: {
        "main.ts": `/// <reference path="./globals.d.ts" />
class Held {
  own = 1;
}
enum Level {
  Own = 4,
}
function show(level: Level): string {
  return level + " " + Level[level];
}
console.log(new Held().own, new Held().declared, show(Level.Own), show(3));
`,
        "globals.d.ts": `interface Held {\n  declared?: number;\n}\ndeclare enum Level {\n  One = 1,\n  Three = 3,\n}\n`,
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            strict: true,
            module: "preserve",
            target: "esnext",
            moduleDetection: "auto",
            noEmit: true,
            types: [],
          },
          files: ["main.ts"],
        }),
      },
      errors: [],
      stdout: "1 undefined 4 Own 3 undefined\n",
    },
  "a type of a script of the program with the name of a class that Bun declares": {
    files: {
      "main.ts": `type ResolveMessage = { two: number };\nconst held: ResolveMessage = { two: 2 };\nconsole.log(held.two);\n`,
    },
    errors: [],
    stdout: "2\n",
  },
  "scripts of the project share a constant, and one assigns to it: the build does not find the name, `bun check` says what is wrong with its use":
    {
      files: {
        "main.ts": `/// <reference path="./shared.ts" />\nlimit = 2;\nconsole.log(limit);\n`,
        "shared.ts": `const limit = 1;\n`,
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            strict: true,
            module: "preserve",
            target: "esnext",
            moduleDetection: "auto",
            noEmit: true,
            types: [],
          },
          files: ["shared.ts", "main.ts"],
        }),
      },
      errors: ["TS2304"],
    },
  "members that Bun adds, spelled right": {
    files: {
      "main.ts": `console.log(typeof import.meta.dirname, typeof new Headers().toJSON());\nexport {};\n`,
      "tsconfig.json": withoutTypes("ESNext"),
    },
    errors: [],
    stdout: "string object\n",
  },
  "a script of a project that has Bun's types installed: its class and its enum go on in a declaration file": {
    files: scriptWithTypesOfBunInstalled(""),
    errors: [],
    stdout: "1 undefined 4 Fine 3 undefined\n",
  },
  "constants join the halves of a surrogate pair to a key that is also written whole, with Bun's types installed": {
    files: {
      ...scriptWithTypesOfBunInstalled(""),
      "main.ts": `export {};
const joined = \`\${"\\ud83d"}\${"\\ude00"}\`;
const faces = { [joined]: 1, "\\u{1F600}": 2 };
class Faces {
  [joined] = 1;
  "\\u{1F600}" = "two";
}
console.log(Object.keys(faces).length, faces["\\u{1F600}"], new Faces()["\\u{1F600}"]);
`,
    },
    errors: [],
    stdout: "1 2 two\n",
  },
  "a key written twice, with Bun's types installed": {
    files: {
      ...scriptWithTypesOfBunInstalled(""),
      "main.ts": `export {};\nconst sizes = { small: 1, small: 2 };\nconsole.log(sizes.small);\n`,
    },
    errors: ["TS1117"],
  },
  "a key written twice, without a tsconfig.json": {
    files: { "main.ts": `export {};\nconst sizes = { small: 1, small: 2 };\nconsole.log(sizes.small);\n` },
    errors: ["TS1117"],
  },
  "a script of a project that has Bun's types installed: a mistake of its own still stops the build": {
    files: scriptWithTypesOfBunInstalled(`const wrong: number = "text";\nconsole.log(wrong);\n`),
    errors: ["TS2322"],
  },
  "a package's source accepts less than its declarations: that alone stops no build": {
    files: packageWithAotSource(`import { join } from "made-up";\nconsole.log(join(7, 1));\n`, ...joins),
    errors: [],
    stdout: "7:1\n",
  },
  "a package's source refuses the first argument, and the second is a mistake": {
    files: packageWithAotSource(`import { join } from "made-up";\nconsole.log(join(7, "x"));\n`, ...joins),
    errors: ["TS2345"],
  },
  "a package's source lacks a member, and the member's declared type is a mistake": {
    files: packageWithAotSource(
      `import { crate } from "made-up";\nconst text: string = crate.extra;\nconsole.log(text);\n`,
      `export declare const crate: { weight: number; extra: number };\n`,
      `export const crate = { weight: 1 };\n`,
    ),
    errors: ["TS2322"],
  },
  "a package's source lacks a member, and the mistake is a statement later": {
    files: packageWithAotSource(
      `import { crate } from "made-up";\nconst extra = crate.extra;\nconst text: string = extra;\nconsole.log(text);\n`,
      `export declare const crate: { weight: number; extra: number };\n`,
      `export const crate = { weight: 1 };\n`,
    ),
    errors: ["TS2322"],
  },
  "a package's source lacks an overload, and the mistake is in the file that imports the result": {
    files: {
      ...packageWithAotSource(
        `import { made } from "./part";\nconst text: string = made;\nconsole.log(text);\n`,
        `export declare function pick(value: number): number;\nexport declare function pick(value: string): string;\n`,
        `export function pick(value: string): string {\n  return value;\n}\n`,
      ),
      "part.ts": `import { pick } from "made-up";\nexport const made = pick(7);\n`,
    },
    errors: ["TS2322"],
  },
  "a package's source refuses an argument beside what bun check only reports for lack of Bun's types": {
    files: packageWithAotSource(
      `import { join } from "made-up";\nconsole.log(join(7, 1), typeof Bun.version, typeof setTimeout(() => {}, 1).unref);\n`,
      ...joins,
    ),
    errors: [],
    stdout: "7:1 string function\n",
  },
  "a name that only the DOM declares is called with arguments that its declaration refuses": {
    files: {
      "package.json": `{ "name": "plainest" }\n`,
      "main.ts": `if (typeof print === "function") print("a", 1);\nconsole.log("done");\n`,
    },
    errors: [],
    stdout: "done\n",
  },
  "a package's source refuses an argument beside a file that isn't under the rootDir of its importer": {
    files: packagesWithRootDirectories(`console.log(join(7, two));\n`),
    errors: [],
    stdout: "7:2\n",
  },
  "the same, and a mistake beside them": {
    files: packagesWithRootDirectories(`const wrong: string = two;\nconsole.log(join(7, two), wrong);\n`),
    errors: ["TS2322"],
  },
  "a package's source refuses an argument beside a mistake in a branch that never runs": {
    files: packageWithAotSource(
      `import { join } from "made-up";\nif (false) {\n  const wrong: number = "text";\n  console.log(wrong);\n}\nconsole.log(join(7, 1));\n`,
      ...joins,
    ),
    errors: [],
    stdout: "7:1\n",
  },
  "a package's source refuses an argument beside a mistake in a function that nothing calls": {
    files: packageWithAotSource(
      `import { join } from "made-up";\nfunction unused() {\n  const wrong: number = "text";\n  return wrong;\n}\nconsole.log(join(7, 1));\n`,
      ...joins,
    ),
    errors: [],
    stdout: "7:1\n",
  },
};

// The plainest folder there is: a package.json and one file. What Bun itself provides is no error there.
const provided: Record<string, [text: string, stdout: string]> = {
  "the text of the body of a request that Bun.serve hands over": [
    `const server = Bun.serve({ port: 0, async fetch(request) { return new Response(await request.body!.text()); } });
console.log(await (await fetch(server.url, { method: "POST", body: "a" })).text());
server.stop(true);
`,
    "a\n",
  ],
  "the text of the body of a request with a written type": [
    `async function answer(request: Request): Promise<string> {
  return await request.body!.text();
}
console.log(await answer(new Request("http://localhost/", { method: "POST", body: "a" })));
`,
    "a\n",
  ],
  "the JSON of the body of a response": [`console.log((await new Response('{"a":1}').body!.json()).a);\n`, "1\n"],
  "the bytes of the body of a response": [`console.log((await new Response("ab").body!.bytes()).length);\n`, "2\n"],
  "the blob of the body of a response": [`console.log((await new Response("ab").body!.blob()).size);\n`, "2\n"],
  "the JSON of a blob": [`console.log((await new Blob(['{"a":1}']).json()).a);\n`, "1\n"],
  "headers as JSON": [`console.log(new Headers({ a: "1" }).toJSON().a);\n`, "1\n"],
  "console.write": [`console.write("written\\n");\n`, "written\n"],
  "what Bun adds to import.meta": [`console.log(typeof import.meta.dir, import.meta.main);\n`, "string true\n"],
  "a timer that is asked whether it holds the process": [
    `const timer = setTimeout(() => {}, 1);\ntimer.unref();\nconsole.log(timer.hasRef());\n`,
    "false\n",
  ],
  "an option that Bun adds to fetch": [
    `const server = Bun.serve({ port: 0, fetch: () => new Response("a") });
console.log(await (await fetch(server.url, { verbose: false })).text());
server.stop(true);
`,
    "a\n",
  ],
  "Response.json": [`console.log(await Response.json({ a: 1 }).text());\n`, '{"a":1}\n'],
};
for (const [name, [text, stdout]] of Object.entries(provided)) {
  rows[`a package.json and one file: ${name}`] = {
    files: { "package.json": `{ "name": "plainest" }\n`, "main.ts": text },
    errors: [],
    stdout,
  };
}

const placesOfBuild = (stderr: string) => {
  const lines = stderr.split("\n");
  return lines.flatMap((line, index) => {
    const code = /^error: (TS\d+):/.exec(line)?.[1];
    // A message may go on over several lines.
    const at = lines.slice(index + 1).find(next => /^\s+at /.test(next)) ?? "";
    const place = /([^/\\]+):(\d+):(\d+)$/.exec(at);
    return code && place ? [`${place[1]}(${place[2]},${place[3]}) ${code}`] : [];
  });
};
const placesOfCheck = (stdout: string) =>
  stdout.split("\n").flatMap(line => {
    const found = /^(?:.*[/\\])?([^/\\(]+)\((\d+),(\d+)\): error (TS\d+):/.exec(line);
    return found ? [`${found[1]}(${found[2]},${found[3]}) ${found[4]}`] : [];
  });

describe.skipIf(!!unsupported)("what a build reports is a part of what bun check reports", () => {
  for (const [name, { files, errors, stdout }] of Object.entries(rows)) {
    test(name, () =>
      slot(async () => {
        using dir = tempDir("aot-a-build-asks-bun-check", files);
        const folder = String(dir);
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation, "./main.ts", "--outfile", "main"],
          folder,
          env,
        );
        const reported = placesOfBuild(built.stderr);
        expect({ errors: reported.map(place => place.split(" ")[1]), exitCode: built.exitCode }).toEqual({
          errors,
          exitCode: errors.length ? 1 : 0,
        });
        // Without a tsconfig.json the build asks under the default library of tsc, which has the DOM. `bun check` by itself takes ESNext alone.
        const library = "tsconfig.json" in files ? [] : ["--lib", "esnext,dom"];
        const checked = await spawned([bunExe(), "check", ...library, "./main.ts"], folder, env);
        const withoutCode = (place: string) => place.split(" ")[0];
        expect(placesOfCheck(checked.stdout + checked.stderr).map(withoutCode)).toEqual(
          expect.arrayContaining(reported.map(withoutCode)),
        );
        if (stdout === undefined) return;
        const ran = await spawned([join(folder, isWindows ? "main.exe" : "main")], folder, env);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout, exitCode: 0 });
      }),
    );
  }
});
