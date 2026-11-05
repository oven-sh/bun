// `--explain=guards` lists the type guards that can fail at run time, and `--explain=guards-json` prints the same guards, one
// JSON object per line. Where a guess comes from decides what its failure costs. The wording of an entry is tested beside the
// code that writes it: src/aot/report.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes } from "harness";
import { slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

type Files = Record<string, string>;

interface Place {
  file: string;
  line: number;
  col: number;
}

interface Guard extends Place {
  aot: "type-check";
  cause: string;
  function: string;
  failure: "leaves" | "rejoins" | "throws";
  copies: number;
  type: string;
  from?: Place;
}

interface Report {
  stdout: string;
  /** What stderr holds, but for empty lines and the line that ends `bun check`. */
  lines: string[];
  guards: Guard[];
}

const env = { ...bunEnv, NO_COLOR: "1" };
const buildTimeout = 300_000;
const textAndJSON = ["--explain=guards", "--explain=guards-json"];
const membersOfPlace = "file line col";
const membersOfGuard = `aot cause ${membersOfPlace} function failure copies type`;
/** In the order in which the text counts them. */
const causes = [
  "wrong-type",
  "untyped-value",
  "unknown-callee",
  "untyped-collection",
  "analysis-disabled",
  "read-before-init",
];
const costOfFailure = {
  leaves: "when it fails, the rest of the call runs in the function's slow version",
  rejoins: "when it fails, only this operation is slower",
  throws: "when it fails, the operation throws, as it does in plain JavaScript",
};

// A function that calls itself is never inlined, so it keeps entries of its own, whoever calls it.
const folders = `export class Folder {
  constructor(
    public name: string,
    public inner: Folder | null,
  ) {}
}

export function pathOf(folder: Folder): string {
  const inner = folder.inner;
  return inner === null ? folder.name : folder.name + "/" + pathOf(inner);
}

console.log(pathOf(new Folder("a", new Folder("b", null))));
`;

const proven: Files = { "main.ts": folders };

const withParsedArgument: Files = {
  "main.ts": folders + `console.log(pathOf(JSON.parse('{ "name": "c", "inner": null }')));\n`,
};

// Three reads lean on `point` and two products on `scale`, so `area` has a guard in front of a fast version and a slow one.
// The guard stands in a unit of its own, or in front of the copy where a caller takes the fast version in.
const withParsedPoint: Files = {
  "main.ts": `class Point {
  x = 1;
  y = 2;
}

function area(point: Point, scale: number): number {
  const across = point.x * scale;
  const down = point.y * scale;
  return across * down + point.x;
}

console.log(area(new Point(), 2));
console.log(area(JSON.parse('{ "x": 3, "y": 4 }'), 2));
`,
};

// docs/compiler/types.mdx, "When a value doesn't match its type".
const exampleOfTheDocs: Files = {
  "main.ts": `function double(n: number): number {
  return n * 2;
}

const body: any = JSON.parse('{"visits":"3"}');
console.log(double(body.visits));
`,
};

// JSON.stringify calls the replacer with values that the compiler does not follow, and only a Crate has both of the names
// that are read off them.
const withReplacer: Files = {
  "main.ts": `class Crate {
  constructor(
    public crateLabel: string,
    public cargoWeight: number,
  ) {}
}

function shorten(key: string, held: any) {
  return key === "crate" ? held.crateLabel + " " + held.cargoWeight : held;
}

console.log(JSON.stringify({ crate: new Crate("a", 3) }, shorten));
`,
};

const linesOf = (text: string) =>
  text
    .split("\n")
    .map(line => line.trimEnd())
    .filter(line => line !== "");

const lineWith = (files: Files, text: string) =>
  files["main.ts"]!.split("\n").findIndex(line => line.includes(text)) + 1;

async function run(files: Files, ...operands: string[]): Promise<Report> {
  using dir = tempDirWithBunTypes("aot-explain-guards", files);
  const { stdout, stderr, exitCode, signal } = await spawned([bunExe(), ...operands], String(dir), env);
  const said = exitCode === 0 ? "" : stdout + stderr;
  expect({ exitCode, signal, said }).toEqual({ exitCode: 0, signal: null, said: "" });
  const guards = linesOf(stdout)
    .filter(line => line.startsWith("{"))
    .map(line => JSON.parse(line) as Guard);
  const lines = linesOf(stderr)
    .filter(line => !line.includes("No type errors"))
    .map(line => (/^ +at /.test(line) ? line.replaceAll("\\", "/") : line));
  return { stdout, lines, guards };
}

const check = (files: Files, ...flags: string[]) => run(files, "check", "--aot", "--no-pretty", ...flags, "main.ts");
const compile = (files: Files, ...flags: string[]) => run(files, "compile", "./main.ts", ...flags);

const at = ({ file, line, col }: Place) => `   at ${file}:${line}:${col}`;
const withoutWording = (line: string) => line.replace(/^(note: (?:\d+\.|fix:)) .*$/, "$1");

/** The lines of the entries that the JSON decides, without their wording, in the order in which they are printed. */
const linesDecidedBy = (guards: Guard[]) =>
  guards.flatMap((guard, index) => [
    `note: ${index + 1}.`,
    ...(guard.line > 0 ? [at(guard)] : []),
    ...(guard.from && at(guard.from) !== at(guard) ? ["note: The value comes from here.", at(guard.from)] : []),
    ...(guard.function ? [`note: in function '${guard.function}'`] : []),
    ...(guard.type ? [`note: type '${guard.type}'`] : []),
    `note: ${costOfFailure[guard.failure]}`,
    "note: fix:",
  ]);

function expectTextAndJSONToAgree({ lines, guards }: Report) {
  const [total, byCause, ...entries] = lines;
  const counted = `${guards.length} type guard${guards.length === 1 ? "" : "s"}`;
  expect(total).toStartWith(`note: ${counted} can fail at run time. `);
  expect(byCause).toStartWith("note: By cause: ");
  expect(byCause!.match(/\d+/g)?.map(Number)).toEqual(
    causes.map(cause => guards.filter(guard => guard.cause === cause).length).filter(count => count > 0),
  );
  const decided = linesDecidedBy(guards);
  expect(entries.map(withoutWording).filter(line => decided.includes(line))).toEqual(decided);
}

async function explain(files: Files) {
  const report = await check(files, ...textAndJSON);
  expect(report.guards).not.toBeEmpty();
  expectTextAndJSONToAgree(report);
  return report;
}

let parsedArgumentReport: Promise<Report> | undefined;
const explainParsedArgument = () => (parsedArgumentReport ??= explain(withParsedArgument));

describe.concurrent("--explain=guards", () => {
  test(
    "a parameter that takes a parsed value has a guard that leaves",
    () =>
      slot(async () => {
        const { guards } = await explain(withParsedPoint);
        expect(guards).toContainEqual(
          expect.objectContaining({
            file: "main.ts",
            line: lineWith(withParsedPoint, "function area"),
            function: "area",
            failure: "leaves",
            type: "Point",
          }),
        );
      }),
    buildTimeout,
  );

  test(
    "the guard in the example of the documentation is listed",
    () =>
      slot(async () => {
        const { guards } = await explain(exampleOfTheDocs);
        expect(guards).toEqual([
          expect.objectContaining({ file: "main.ts", line: 1, function: "double", failure: "leaves", copies: 1 }),
        ]);
      }),
    buildTimeout,
  );

  test(
    "a guess from the names that are read off a parameter rejoins",
    () =>
      slot(async () => {
        const { guards } = await explain(withReplacer);
        const line = lineWith(withReplacer, "held.crateLabel");
        const failures = guards
          .filter(guard => guard.function === "shorten" && guard.line === line)
          .map(guard => guard.failure);
        expect(failures).toContain("rejoins");
        expect(failures).not.toContain("leaves");
      }),
    buildTimeout,
  );

  test(
    "a program whose types are all proven has no guard",
    () =>
      slot(async () => {
        const { stdout, lines } = await check(proven, ...textAndJSON);
        expect({ stdout: linesOf(stdout), lines }).toEqual({
          stdout: [],
          lines: ["note: No type guard can fail at run time."],
        });
      }),
    buildTimeout,
  );

  test(
    "=guards-json prints an object per guard, and no text",
    () =>
      slot(async () => {
        const { stdout, lines, guards } = await check(withParsedArgument, "--explain=guards-json");
        expect(lines).toEqual([]);
        expect(guards).not.toBeEmpty();
        expect(linesOf(stdout)).toHaveLength(guards.length);
        for (const guard of guards) {
          expect(Object.keys(guard).join(" ")).toBe(guard.from ? `${membersOfGuard} from` : membersOfGuard);
          if (guard.from) expect(Object.keys(guard.from).join(" ")).toBe(membersOfPlace);
          expect(guard.aot).toBe("type-check");
          expect(causes).toContain(guard.cause);
          expect(Object.keys(costOfFailure)).toContain(guard.failure);
          expect(guard.copies).toBeGreaterThan(0);
        }
      }),
    buildTimeout,
  );

  test(
    "bun compile prints what bun check --aot prints",
    () =>
      slot(async () => {
        const said = ({ lines, guards }: Report) => ({ lines, guards });
        const checked = await explainParsedArgument();
        expect(said(await compile(withParsedArgument, ...textAndJSON))).toEqual(said(checked));
      }),
    buildTimeout,
  );
});
