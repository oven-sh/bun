import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

async function build(outputFolder: string, sourceFolder: string, program: string): Promise<string> {
  const executable = join(outputFolder, "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./" + program, "--outfile", executable],
    sourceFolder,
    bunEnv,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  return executable;
}

const programsAbout = (topic: string) => join(import.meta.dir, "programs", topic);

const withCensus = { ...bunEnv, BUN_JSC_dumpAOTObjectCensusAtExit: "1" };

function censusLines(stderr: string): string[] {
  const lines = stderr.split("\n").filter(line => line !== "");
  expect(lines.filter(line => !line.startsWith("AOT live: "))).toEqual([]);
  return lines;
}

/** Free cells, strings and the cells of Bun's own classes depend on when collections ran. These lines depend on the program alone. */
function programLines(lines: string[]): string[] {
  return lines.filter(line =>
    /^AOT live: (layout|environment|closures-of|order-state|slots|placed|field|states|granules) /.test(line),
  );
}

/** The numbers that the pattern captures, for each line that matches it. */
function numbersIn(lines: string[], pattern: RegExp): number[][] {
  return lines.flatMap(line => {
    const match = pattern.exec(line);
    return match ? [match.slice(1).map(Number)] : [];
  });
}

const sum = (numbers: number[]) => numbers.reduce((total, number) => total + number, 0);

/** What follows `AOT live: <kind> <index> <layout> `, for each such line. */
function linesAbout(census: string[], kind: string, layout: string): string[] {
  return census.flatMap(line => {
    const [, , lineKind, , name, ...rest] = line.split(" ");
    return lineKind === kind && name === layout ? [rest.join(" ")] : [];
  });
}

const liveObjects = (census: string[], layout: string) =>
  numbersIn(linesAbout(census, "layout", layout), /^cell \d+ objects (\d+)$/);

/** The layout of an interface has no name in the executable. The census prints its first four fields, and a layout has them in the order of their names. */
function recordName(...fields: string[]): string {
  const sorted = fields.toSorted();
  return `{_${sorted.slice(0, 4).join(",_")}${sorted.length > 4 ? ",_..." : ""}_}`;
}

// TODO: two runs of one executable count 1,001 and 1,000 objects of one class.
test.todo(
  "BUN_JSC_dumpAOTObjectCensusAtExit=1 prints what is alive when the program exits",
  async () => {
    using dir = tempDir("aot-object-census", {});
    const executable = await build(String(dir), programsAbout("objects"), "live-object-census.ts");
    const first = await run([executable], String(dir), withCensus);
    const second = await run([executable], String(dir), withCensus);
    const withoutCensus = await run([executable], String(dir), bunEnv);

    expect(withoutCensus).toEqual({ stdout: first.stdout, stderr: "", exitCode: 0 });
    expect(first.exitCode).toBe(0);
    expect({ stdout: second.stdout, exitCode: second.exitCode }).toEqual({ stdout: first.stdout, exitCode: 0 });

    const census = censusLines(first.stderr);
    expect(programLines(censusLines(second.stderr))).toEqual(programLines(census));

    // The 100,000 points that the program dropped are not among them.
    expect(numbersIn(census, /^AOT live: layout \d+ Point cell \d+ objects (\d+)$/)).toEqual([[1000]]);
    expect(numbersIn(census, /^AOT live: layout \d+ Holder cell \d+ objects (\d+)$/)).toEqual([[10]]);
    expect(numbersIn(census, /^AOT live: layout \d+ Button cell \d+ objects (\d+)$/)).toEqual([[100]]);

    expect(
      numbersIn(
        census,
        /^AOT live: field \d+ Holder items \S+ store \d+ filled (\d+) arrays (\d+) empty (\d+) elements (\d+) capacity \d+ maps (\d+) /,
      ),
    ).toEqual([[10, 10, 4, 39, 0]]);
    expect(
      numbersIn(
        census,
        /^AOT live: field \d+ Holder lookup \S+ store \d+ filled (\d+) arrays (\d+) .* maps (\d+) empty-maps (\d+) /,
      ),
    ).toEqual([[5, 0, 5, 2]]);

    expect(
      numbersIn(census, /^AOT live: closures-of \d+ ticket full (\d+) slim (\d+) reified (\d+) /).map(sum),
    ).toEqual([500]);

    // Thirty buttons had `press` read as a value. The calls of the other seventy created no closure, and neither did the census.
    expect(
      numbersIn(census, /^AOT live: field \d+ Button press \S+ store \d+ filled (\d+) .* deferred (\d+)$/),
    ).toEqual([[30, 70]]);
    expect(numbersIn(census, /^AOT live: closures-of \d+ press full (\d+) slim (\d+) reified (\d+) /).map(sum)).toEqual(
      [30],
    );
  },
  240_000,
);

const lateFields = Array.from({ length: 20 }, (_, index) => "late" + index);
const entriesWithLateFields = `declare const console: { log(...values: unknown[]): void };
class Entry {
  id: number;
${lateFields.map(name => `  ${name}?: number | string;`).join("\n")}
  constructor(id: number) {
    this.id = id;
  }
}

function fillFirst(entry: Entry, value: number): void {
  entry.${lateFields[0]} = value;
}
function fillRest(entry: Entry, value: number): void {
${lateFields
  .slice(1)
  .map(name => `  entry.${name} = value;`)
  .join("\n")}
}

const entries: Entry[] = [];
for (let i = 0; i < 100; i++) {
  const entry = new Entry(i);
  if (i < 30) fillFirst(entry, i);
  if (i < 10) fillRest(entry, i);
  entries.push(entry);
}

function sumEntries(): number {
  let sum = 0;
  for (const entry of entries) {
    sum += entry.id;
${lateFields.map(name => `    if (typeof entry.${name} === "number") sum += entry.${name};`).join("\n")}
  }
  return sum;
}
// Reachable from the global object, the function keeps the entries alive until the exit.
(globalThis as any).sumEntries = sumEntries;
console.log(sumEntries());
export {};
`;

// TODO: the hundred objects are counted in two groups, 84 and 16.
test.todo(
  "the census says what each field of the live objects holds, and how many granules their Extensions hold",
  async () => {
    using dir = tempDir("aot-object-census-late-fields", { "main.ts": entriesWithLateFields });
    const executable = await build(String(dir), String(dir), "main.ts");
    const ran = await run([executable], String(dir), withCensus);
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "6240\n", exitCode: 0 });

    const census = censusLines(ran.stderr);
    expect(liveObjects(census, "Entry")).toEqual([[100]]);

    const states = linesAbout(census, "states", "Entry").map(line => {
      const [, name, placement, ...counts] =
        /^(\S+) (in-line|out-of-line) offset \d+ width \d+ store \d+ without-storage (\d+) absent (\d+) undefined (\d+) values (\d+)$/.exec(
          line,
        )!;
      const [withoutStorage, absent, holdsUndefined, values] = counts.map(Number);
      return {
        name,
        isOutOfLine: placement === "out-of-line",
        withoutStorage,
        empty: withoutStorage + absent + holdsUndefined,
        values,
      };
    });
    const countsOf = (name: string) =>
      states.filter(field => field.name === name).map(({ empty, values }) => ({ empty, values }));
    // Every object is counted once for each field: all have an id, thirty the first late field, ten the others.
    expect(countsOf("id")).toEqual([{ empty: 0, values: 100 }]);
    expect(countsOf(lateFields[0])).toEqual([{ empty: 70, values: 30 }]);
    for (const name of lateFields.slice(1)) expect(countsOf(name)).toEqual([{ empty: 90, values: 10 }]);

    // Twenty fields that most objects lack don't all fit in the cell. An object that never got one of them has no Extension.
    const outOfLine = states.filter(field => field.isOutOfLine && lateFields.includes(field.name));
    expect(outOfLine).not.toBeEmpty();
    for (const field of outOfLine) expect(field.withoutStorage).toBeGreaterThanOrEqual(70);

    const granules = numbersIn(linesAbout(census, "granules", "Entry"), /^held (\d+) with-value (\d+) objects (\d+)$/);
    expect(sum(granules.map(([, , objects]) => objects))).toBe(
      outOfLine.some(field => field.name === lateFields[0]) ? 30 : 10,
    );
    for (const [held, withValue] of granules) expect(withValue).toBeWithin(1, held + 1);
    expect(sum(granules.map(([, withValue, objects]) => withValue * objects))).toBeGreaterThanOrEqual(
      sum(outOfLine.map(field => field.values)),
    );
  },
  240_000,
);

// TODO: rows of a typed query are made without a layout.
test.todo(
  "rows of sql<Row[]> have the layout of Row, or none where no typed row can be built",
  async () => {
    using dir = tempDir("aot-object-census-sql-rows", {});
    const executable = await build(
      String(dir),
      programsAbout("data-from-outside"),
      "sql-typed-rows-optional-and-wide.ts",
    );
    const ran = await run([executable], String(dir), withCensus);
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).toContain("retained 4,16,2,1,1\n");

    const census = censusLines(ran.stderr);
    const sparse = recordName("id", "note", "rank");
    const price = recordName("amount");
    const full = recordName("c00", "c01", "c02", "c03", "c04");
    expect(liveObjects(census, sparse)).toEqual([[4]]);
    expect(liveObjects(census, price)).toEqual([[16]]);
    expect(liveObjects(census, full)).toEqual([[2]]);
    // Huge starts with f00. Labeled has id and the method label.
    expect(census.filter(line => /^AOT live: layout \d+ \{_(f00|id,_label|id_\})/.test(line))).toEqual([]);
  },
  240_000,
);

// TODO: rows of a typed query are made without a layout.
test.todo(
  "number and boolean columns of sql<Row[]> fill every slot form of a typed row",
  async () => {
    using dir = tempDir("aot-object-census-sql-unboxed-columns", {});
    const executable = await build(
      String(dir),
      programsAbout("data-from-outside"),
      "sql-typed-rows-unboxed-columns.ts",
    );
    const ran = await run([executable], String(dir), withCensus);
    expect(ran.exitCode).toBe(0);
    expect(ran.stdout).toContain("retained 6,6,10,6,6\n");

    const census = censusLines(ran.stderr);
    const position = recordName("station", "sequence");
    const counter = recordName("count");
    const level = recordName("level", "code");
    const flags = recordName("isValid", "mark");
    const sample = recordName(
      "site",
      "run",
      "depth",
      "weight",
      "grade",
      "isFinal",
      "note",
      "label",
      "width",
      "height",
      "span",
      "area",
      "volume",
      "speed",
      "angle",
      "isChecked",
    );

    // One retained row of each type holds a value that its field does not accept, so it is a plain object.
    expect(liveObjects(census, position)).toEqual([[5]]);
    expect(liveObjects(census, counter)).toEqual([[5]]);
    expect(liveObjects(census, level)).toEqual([[9]]);
    expect(liveObjects(census, flags)).toEqual([[5]]);
    expect(liveObjects(census, sample)).toEqual([[5]]);

    // Enumerators of SlotRepresentation in aot/ir/schema/runtime-records.def. A `placed` line lists the fields in the cell as offset:representation.
    const JSValue = 0,
      OptionalInt32 = 8,
      OptionalDouble = 10,
      OptionalBoolean = 13;
    const representationsInCell = (layout: string) =>
      linesAbout(census, "placed", layout)
        .flatMap(line => /^size \d+ extension \d :(.*)$/.exec(line)![1].trim().split(" "))
        .map(placed => Number(placed.split(":")[1]))
        .sort((a, b) => a - b);
    expect(representationsInCell(position)).toEqual([OptionalInt32, OptionalInt32]);
    expect(representationsInCell(counter)).toEqual([OptionalInt32]);
    expect(representationsInCell(level)).toEqual([JSValue, OptionalDouble]);
    expect(representationsInCell(flags)).toEqual([JSValue, OptionalBoolean]);
    // Some of the 16 fields of Sample are outside the cell.
    expect(representationsInCell(sample).length).toBeWithin(1, 16);
  },
  240_000,
);

test("a rest array that is made from the arguments in the frame has room for them and no more", async () => {
  using dir = tempDir("aot-object-census-rest-arrays", {});
  // Native code calls the functions of the program, so the build has something to say about untyped code.
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./rest-arrays-made-from-the-frame.ts", "--outfile", executable],
    programsAbout("arrays"),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const ran = await run([executable], String(dir), withCensus);
  expect(ran.exitCode).toBe(0);
  expect(ran.stdout).toStartWith("3000 1000,1000,1000 499500\n");

  const census = censusLines(ran.stderr);
  const arrays = (length: number, capacity: number) =>
    sum(numbersIn(census, new RegExp(`^AOT live: array length ${length} capacity ${capacity} arrays (\\d+)$`)).flat());
  // A capacity is odd, so that header and elements fill cells of 16 bytes. An array or two of Bun's own may have the same length.
  expect(arrays(0, 1)).toBeWithin(1000, 1011);
  expect(arrays(1, 1)).toBeWithin(1000, 1011);
  expect(arrays(2, 3)).toBeWithin(1000, 1011);
  expect(arrays(1, 3)).toBeLessThan(10);
  // An empty literal still gets the room that the arrays of its place have needed: half of these 1,000 hold four numbers.
  expect(arrays(0, 5)).toBeWithin(500, 511);
  expect(arrays(4, 5)).toBeWithin(500, 511);
}, 240_000);

test("a call by name without surplus arguments makes no list of them", async () => {
  using dir = tempDir("aot-object-census-empty-argument-lists", {});
  // The program is JavaScript, so the build has something to say about untyped code.
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "./no-list-for-calls-without-surplus-arguments.js",
      "--outfile",
      executable,
    ],
    programsAbout("arrays"),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  // Without collections the census counts every cell that was ever made.
  const ran = await run([executable], String(dir), { ...withCensus, BUN_JSC_useGC: "0" });
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "50025000 2\n", exitCode: 0 });

  const census = censusLines(ran.stderr);
  const emptyArrays = sum(numbersIn(census, /^AOT live: array length 0 capacity \d+ arrays (\d+)$/).flat());
  expect(emptyArrays).toBeLessThan(1000);
  // Every such call was handed the one list of the instance. Nothing was written to it, and compiled code takes it for an array like any other.
  expect(numbersIn(census, /^AOT live: empty-argument-list length (\d+) pristine (\d)$/)).toEqual([[0, 1]]);
}, 240_000);

test("an array that is made for one call and only read there is no cell", async () => {
  using dir = tempDir("aot-object-census-arrays-that-carry-arguments", {});
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const command = [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "--aot-disable=InlineCalls",
    "./no-cells-for-arrays-that-carry-arguments.js",
    "--outfile",
    executable,
  ];
  const built = await run(command, programsAbout("arrays"), bunEnv);
  expect(built.exitCode).toBe(0);
  // Without collections the census counts every cell that was ever made.
  const ran = await run([executable], String(dir), { ...withCensus, BUN_JSC_useGC: "0" });
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "350165000 10000 9999\n", exitCode: 0 });

  const census = censusLines(ran.stderr);
  const arraysOfLength = (length: number) =>
    sum(numbersIn(census, new RegExp(`^AOT live: array length ${length} capacity \\d+ arrays (\\d+)$`)).flat());
  // The literal of three, the three surplus arguments and the rest array of five lie in frames. The literal of four is kept, so each is a cell.
  expect(arraysOfLength(3)).toBeLessThan(100);
  expect(arraysOfLength(5)).toBeLessThan(100);
  expect(arraysOfLength(4)).toBeWithin(10000, 10100);
}, 240_000);

test("a rest array that is passed on behind the values a known function names is that function's rest array", async () => {
  using dir = tempDir("aot-object-census-rest-arrays-that-are-passed-on", {});
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const command = [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "--aot-disable=InlineCalls",
    "./no-list-for-rest-arrays-that-are-passed-on.js",
    "--outfile",
    executable,
  ];
  const built = await run(command, programsAbout("arrays"), bunEnv);
  expect(built.exitCode).toBe(0);
  // Without collections the census counts every cell that was ever made.
  const ran = await run([executable], String(dir), { ...withCensus, BUN_JSC_useGC: "0" });
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
    stdout: "100130000 10000 4 9999 10000\n",
    exitCode: 0,
  });

  const census = censusLines(ran.stderr);
  const arraysOfLength = (length: number) =>
    sum(numbersIn(census, new RegExp(`^AOT live: array length ${length} capacity \\d+ arrays (\\d+)$`)).flat());
  // Three arguments for the reader: no rest array, no list of five. Four for the keeper: the one array that it keeps, no list of six.
  expect(arraysOfLength(3)).toBeLessThan(100);
  expect(arraysOfLength(5)).toBeLessThan(100);
  expect(arraysOfLength(4)).toBeWithin(10000, 10100);
  expect(arraysOfLength(6)).toBeLessThan(100);
}, 240_000);

test("an inner function that its siblings only call is never made, and one that a sibling hands on is made once, in the activations that hand it on", async () => {
  using dir = tempDir("aot-object-census-inner-functions", {});
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const program = "./inner-function-made-when-a-sibling-hands-it-on.ts";
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--aot-disable=InlineCalls", program, "--outfile", executable],
    programsAbout("classes-and-closures"),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  // Nothing is collected, so what is alive at the end is everything that was made.
  const ran = await run([executable], String(dir), { ...withCensus, BUN_JSC_useGC: "0" });
  expect(ran.exitCode).toBe(0);
  expect(ran.stdout).toEndWith("\n25259\n");

  const census = censusLines(ran.stderr);
  const made = (name: string) =>
    sum(
      numbersIn(
        census,
        new RegExp(`^AOT live: closures-of \\d+ ${name} full (\\d+) slim (\\d+) reified (\\d+) `),
      ).flat(),
    );
  // Three activations of `declares`, each of which hands `target` on four times.
  expect(made("target")).toBe(3);
  expect({ give: made("give"), other: made("other"), callOnly: made("callOnly") }).toEqual({
    give: 0,
    other: 0,
    callOnly: 0,
  });
  // 3,000 activations of `sometimes`, three of which hand `step` on.
  expect(made("step")).toBe(3);
  expect(made("pass")).toBe(0);
}, 240_000);

test("an arrow function that is stored into a field is made when somebody reads the field, whatever else makes objects of that shape", async () => {
  using dir = tempDir("aot-object-census-closures-in-fields", {});
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const program = "./closures-in-fields-made-when-somebody-reads-them.js";
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", program, "--outfile", executable],
    programsAbout("classes-and-closures"),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  // Nothing is collected, so what is alive at the end is everything that was made.
  const ran = await run([executable], String(dir), { ...withCensus, BUN_JSC_useGC: "0" });
  expect(ran.exitCode).toBe(0);
  expect(ran.stdout).toStartWith("31890 4413435 r1:x:200 r5:x:201\n");

  const census = censusLines(ran.stderr);
  const made = (name: string) =>
    sum(
      numbersIn(
        census,
        new RegExp(`^AOT live: closures-of \\d+ ${name} full (\\d+) slim (\\d+) reified (\\d+) `),
      ).flat(),
    );
  // 3,002 objects of the class. The calls of two of its seven arrows need no function object, and the last lines of the program read a few.
  for (const name of ["renderReply", "statusReply", "setReply", "getReply", "textReply", "jsonReply", "notFoundReply"])
    expect(`${name} ${made(name) < 4}`).toBe(`${name} true`);
  // 2,973 literals of five arrows, and nobody but the last line and 30 spreads reads these three members. A spread reads every member of its source, which makes at most 30 of each.
  // 30 literals of another function hold other arrows of the same names, which may be made, and each of the 30 copies gets a fourthTool of its own.
  for (const [name, most] of [
    ["secondTool", 60],
    ["thirdTool", 60],
    ["fourthTool", 90],
  ] as const)
    expect(`${name} ${made(name) <= most}`).toBe(`${name} true`);
}, 240_000);

test("a function that returns a literal of plain functions makes none of them until somebody reads one", async () => {
  using dir = tempDir("aot-object-census-plain-functions-in-a-returned-literal", {});
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const program = "./plain-functions-in-a-returned-literal-made-when-somebody-reads-them.ts";
  // Without inlining the literal stays in its own function, whose result another function takes.
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--aot-disable=InlineCalls", program, "--outfile", executable],
    programsAbout("classes-and-closures"),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  // Nothing is collected, so what is alive at the end is everything that was made.
  const ran = await run([executable], String(dir), { ...withCensus, BUN_JSC_useGC: "0" });
  expect(ran.exitCode).toBe(0);
  expect(ran.stdout).toBe("6748500 8 2 true 0 never true true object\n");

  const census = censusLines(ran.stderr);
  const made = (name: string) =>
    sum(
      numbersIn(
        census,
        new RegExp(`^AOT live: closures-of \\d+ ${name} full (\\d+) slim (\\d+) reified (\\d+) `),
      ).flat(),
    );
  // 3,002 literals of four functions. A call of a member needs no function object, and the last line compares a few.
  for (const name of ["addOne", "double", "neverCalled", "neverRead"])
    expect(`${name} ${made(name) < 4}`).toBe(`${name} true`);
}, 240_000);

test("a function that is asked for its text again answers with the string it answered before", async () => {
  using dir = tempDir("aot-object-census-function-text", {});
  // The program is JavaScript, so the build has something to say about untyped code.
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "./function-text-asked-again.js", "--outfile", executable],
    programsAbout("classes-and-closures"),
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const ran = await run([executable], String(dir), withCensus);
  expect(ran.exitCode).toBe(0);
  expect(ran.stdout).toStartWith("40000 2 true\n2000 true true\n");

  // The array of the program holds 2,000 answers of one function. Bun's own modules keep a few hundred strings alive.
  const census = censusLines(ran.stderr);
  expect(sum(numbersIn(census, /^AOT live: class string cell \d+ objects (\d+)$/).flat())).toBeWithin(100, 1500);
}, 240_000);
