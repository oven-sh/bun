// Cases for module-identity-*.test.ts: small projects in which a test file mocks a module and loads its importer again.
//
// user imports dep, directly or through a barrel. The main test file gets user, mocks dep or user, gets user again, ends the mock and gets user a third time.
// Each project prints values and identity: `===` on namespace objects, functions, classes and objects, `instanceof` across instances of the module, Object.keys(),
// computed reads, live bindings after a write through each instance, vi.spyOn() on a namespace object, and which module bodies have run.
// A test prints one line, `SAID <test> <column>=<values> ..`. A column `@..` lists the bodies that have run so far, one letter each.

/** The first word of each axis from `factory` on is its default, and a case name leaves it out. */
const axes = {
  /** How the main test file first gets user: by one of three import statements, by import(), by require(), or not before the mock. */
  first: ["named", "namespace", "default", "dynamic", "require", "unloaded"],
  /** The mocked module: dep, user itself, or dep behind `export *`, `export { .. } from` or `export * as space from`. */
  target: ["dependency", "itself", "star-barrel", "named-barrel", "namespace-barrel"],
  call: ["vi.doMock", "vi.mock", "mock.module", "jest.doMock"],
  /** What follows the mocked load: nothing, the end of the mock, mock.restore(), a second mock over the first, or vi.resetModules(). */
  after: ["stop", "unmock", "restore", "remock", "reset"],
  /** A partial factory spreads the original module. */
  factory: ["sync-factory", "async-factory", "partial-factory"],
  reload: ["imported-again", "required-again"],
  /** Another test file that imports user, runs before or after the main one, and may mock the same module itself. */
  otherFile: [
    "no-other-file",
    "namespace-file-before",
    "namespace-file-after",
    "namespace-file-mocks-before",
    "namespace-file-mocks-after",
    "named-file-before",
    "named-file-after",
    "named-file-mocks-before",
    "named-file-mocks-after",
  ],
  /** A --preload file that imports user. */
  preload: ["no-preload", "namespace-preload", "named-preload"],
  /** vi.spyOn() on a namespace object of user. */
  spy: ["no-spy", "spy-on-oldest", "spy-on-newest"],
  /** A helper module imports user and calls read(). */
  helper: ["no-helper", "helper"],
  /** How user exports its functions. In a cycle, dep imports user back. */
  style: ["functions", "arrows", "cycle"],
  /** TypeScript files have specifiers without an extension, and the main test file has an `import type` of user. */
  language: ["javascript", "typescript"],
} as const;
type Axis = keyof typeof axes;
type Choices = { [Key in Axis]: (typeof axes)[Key][number] };
const axisNames = Object.keys(axes) as Axis[];
const alwaysNamed = 4;

/**
 * straight: each column is read once, in straight-line code.
 * looped: one more test file, listed last, has a skipped test that names vi.resetModules(), so every file may load again. Each column is computed 300 times.
 * shared: as looped, and the main test is an array of steps with one loop body that reads everything after every step. So each read site runs before and after each
 * mock, unmock, write and spy, and sees every namespace object held so far.
 * reduced: the smallest project for each kind of difference that the generated cases have found.
 */
export type Variant = "straight" | "looped" | "shared" | "reduced";
export type Case = { variant: Variant; name: string; files: Record<string, string>; args: string[] };

const nameOf = (c: Choices) =>
  axisNames
    .filter((axis, index) => index < alwaysNamed || c[axis] !== axes[axis][0])
    .map(axis => c[axis])
    .join(" ");

/** Draws the same sequence at every run. */
function seededChoice(seed: number) {
  return <T>(from: readonly T[]): T => {
    seed = (seed + 0x6d2b79f5) | 0;
    let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return from[((mixed ^ (mixed >>> 14)) >>> 0) % from.length];
  };
}

function allChoices(): Choices[] {
  const found = new Map<string, Choices>();
  const choose = seededChoice(20261109);
  const defaults = Object.fromEntries(axisNames.map(axis => [axis, axes[axis][0]])) as Choices;
  const add = (changes: Partial<Choices>) => {
    const choices = { ...defaults, ...changes };
    if (!found.has(nameOf(choices))) found.set(nameOf(choices), choices);
  };
  const atRunTime = ["vi.doMock", "mock.module", "jest.doMock"] as const;
  const direct = ["dependency", "itself"] as const;
  const earlier = ["namespace-file-before", "named-file-before"] as const;

  // Two shapes that have found faults before.
  add({
    first: "namespace",
    target: "dependency",
    call: "vi.doMock",
    after: "unmock",
    otherFile: "namespace-file-before",
  });
  add({ first: "unloaded", target: "dependency", call: "vi.doMock", after: "unmock" });
  for (const first of axes.first)
    for (const target of axes.target) {
      const isDirect = target === "dependency" || target === "itself";
      for (const after of isDirect
        ? (["stop", "unmock", "restore", "remock"] as const)
        : (["stop", "unmock", "remock"] as const)) {
        // One test file and nothing else.
        for (const call of ["vi.mock", choose(atRunTime)] as const) add({ first, target, after, call });
        // An earlier test file has loaded user.
        for (const call of ["vi.mock", choose(atRunTime)] as const)
          for (const otherFile of isDirect ? earlier : [choose(earlier)])
            add({ first, target, after, call, otherFile });
      }
    }
  // A preload has loaded user.
  for (const first of axes.first)
    for (const target of direct)
      for (const after of ["stop", "unmock", "remock"] as const)
        for (const preload of ["namespace-preload", "named-preload"] as const)
          add({ first, target, after, call: choose(axes.call), preload });
  // One more choice at a time.
  const single: Partial<Choices>[] = [
    { factory: "async-factory" },
    { factory: "partial-factory" },
    { reload: "required-again" },
    { style: "arrows" },
    { spy: "spy-on-oldest" },
    { spy: "spy-on-newest" },
    { helper: "helper" },
  ];
  for (const first of axes.first)
    for (const target of direct)
      for (const after of ["unmock", "stop"] as const) {
        const base = { first, target, after, call: "vi.doMock" } as const;
        for (const changes of single) add({ ...base, ...changes });
        for (const otherFile of axes.otherFile.filter(
          file => file !== "no-other-file" && !earlier.includes(file as any),
        ))
          add({ ...base, otherFile });
        for (const changes of single) add({ ...base, otherFile: "named-file-before", ...changes });
      }
  for (const first of axes.first)
    for (const target of direct) {
      for (const call of ["vi.doMock", "mock.module"] as const) add({ first, target, call, after: "reset" });
      add({ first, target, call: "vi.doMock", after: "reset", otherFile: "named-file-before" });
    }
  // TypeScript, and an import cycle.
  for (const first of axes.first)
    for (const after of ["stop", "unmock"] as const)
      for (const otherFile of ["no-other-file", "named-file-before"] as const)
        for (const call of ["vi.mock", "vi.doMock"] as const) {
          for (const target of ["dependency", "itself", "star-barrel"] as const)
            add({ first, target, after, otherFile, call, language: "typescript" });
          add({ first, target: "dependency", after, otherFile, call, style: "cycle" });
        }
  // Several choices together. A default is drawn more often than the others.
  const mostly = <T>(usual: T, times: number, others: readonly T[]) => choose([...Array(times).fill(usual), ...others]);
  for (let drawn = 0; drawn < 80; drawn++)
    add({
      first: choose(axes.first),
      target: choose(axes.target),
      call: choose(axes.call),
      factory: choose(axes.factory),
      reload: mostly("imported-again", 2, ["required-again"]),
      after: choose([...axes.after, ...axes.after.filter(after => after !== "reset")]),
      otherFile: mostly("no-other-file", 1, axes.otherFile),
      preload: mostly("no-preload", 2, axes.preload),
      spy: mostly("no-spy", 1, axes.spy),
      helper: mostly("no-helper", 1, axes.helper),
      style: choose(["functions", "arrows"]),
      language: mostly("javascript", 1, axes.language),
    });
  return [...found.values()];
}

/** How a test file holds user: a namespace object, the names of an import statement, or the default export. An object that a setup file built by hand has fewer members. */
type Handle = { kind: "namespace" | "named" | "default"; variable: string; isHandBuilt?: boolean };
const namespaceIn = (variable: string): Handle => ({ kind: "namespace", variable });
const importedNames: Handle = { kind: "named", variable: "" };
const member = (handle: Handle, name: string) => (handle.kind === "named" ? name : `${handle.variable}.${name}`);
const recordRun = (letter: string) => `(globalThis.ran ??= []).push("${letter}");`;
const reportRuns = `said.push("@" + (globalThis.ran ?? []).join(""));`;
const runnerImport = `import { test, vi, jest, mock } from "bun:test";`;

function projectOf(c: Choices, variant: Variant): Case {
  const isCycle = c.style === "cycle";
  const hasHelper = c.helper === "helper";
  const mockedPath = c.target === "itself" ? "./user.mjs" : "./dep.mjs";
  const otherRunsBefore = c.otherFile.endsWith("-before");
  const otherRunsAfter = c.otherFile.endsWith("-after");
  const namedImport = `import { read, seen, calls, total, add, both, Failure, config, fail${isCycle ? ", round" : ""} } from "./user.mjs";`;

  function mockObject(label: string, n: number) {
    if (c.target !== "itself")
      return `{ name: "${label}", hits: ${n}00, bump: () => ${n}00${isCycle ? `, back: () => "${label}:back"` : ""} }`;
    const inner = `read: () => "${label}", seen: "${label}", calls: () => -${n}, add: (n) => -n, both: () => "${label}:both"`;
    const more = `Failure: class extends Error {}, config: { uses: -${n} }, fail: () => { throw new Error("${label}"); }${isCycle ? `, round: () => "${label}:round"` : ""}`;
    return `{ ${inner}, total: -${n}, ${more}, default: { ${inner} } }`;
  }

  function factoryOf(label: string, n: number, call: Choices["call"], kind: Choices["factory"]) {
    if (kind === "sync-factory") return `() => (${mockObject(label, n)})`;
    if (kind === "async-factory") return `async () => (${mockObject(label, n)})`;
    const changed = c.target === "itself" ? `read: () => "${label}"` : `name: "${label}"`;
    if (call === "jest.doMock") return `() => ({ ...jest.requireActual("${mockedPath}"), ${changed} })`;
    return `async () => ({ ...(await vi.importActual("${mockedPath}")), ${changed} })`;
  }

  function mockCall(label: string, n: number, call: Choices["call"], kind = c.factory) {
    const awaited = call === "mock.module" && kind !== "sync-factory" ? "await " : "";
    return `${awaited}${call}("${mockedPath}", ${factoryOf(label, n, call, kind)});`;
  }

  const secondMock = () => mockCall("mock2", 2, c.call === "vi.mock" ? "vi.doMock" : c.call);
  const unmock = c.call === "jest.doMock" ? `jest.dontMock("${mockedPath}");` : `vi.doUnmock("${mockedPath}");`;
  const load = (variable: string, reload = c.reload) =>
    reload === "imported-again"
      ? `const ${variable} = await import("./user.mjs");`
      : `const ${variable} = require("./user.mjs");`;

  function values(column: string, handle: Handle) {
    const parts = [`${member(handle, "read")}()`, member(handle, "seen"), `${member(handle, "calls")}()`];
    if (handle.isHandBuilt) parts.push(member(handle, "total"));
    else if (handle.kind !== "default") {
      parts.push(member(handle, "total"), `${member(handle, "config")}.uses`);
      if (isCycle) parts.push(`${member(handle, "round")}()`);
    }
    return `said.push("${column}=" + [${parts.join(", ")}].join());`;
  }

  const shape = (column: string, { variable: v }: Handle) =>
    `said.push("${column}.keys=" + Object.keys(${v}).join(), "${column}.at=" + [${v}["read"] === ${v}.read, ${v}[key] === ${v}.read, "read" in ${v}].join(), ` +
    `"${column}.type=" + [typeof ${v}, typeof ${v}.read, typeof ${v}.total, Object.prototype.toString.call(${v}).slice(8, -1)].join());`;

  function identity(column: string, { variable: newer }: Handle, { kind, variable: older }: Handle) {
    const parts =
      kind === "namespace"
        ? [
            `${newer} === ${older}`,
            ...["read", "default", "Failure", "config"].map(name => `${newer}.${name} === ${older}.${name}`),
            `thrownBy(${newer}.fail) instanceof ${older}.Failure`,
          ]
        : kind === "named"
          ? [
              ...["read", "add", "Failure", "config"].map(name => `${newer}.${name} === ${name}`),
              `thrownBy(${newer}.fail) instanceof Failure`,
            ]
          : [`${newer}.default === ${older}`, `${newer}.read === ${older}.read`];
    return `said.push("${column}=" + [${parts.join(", ")}].join());`;
  }

  /** Compares a handle with what the preload and an earlier test file have kept. */
  function identityAcrossFiles(column: string, handle: Handle, hasEarlierFile: boolean) {
    const compared = (held: string) =>
      [
        ...(handle.kind === "namespace" ? [`${handle.variable} === ${held}`] : []),
        `${member(handle, "read")} === ${held}.read`,
      ].join(", ");
    return [
      ...(c.preload === "no-preload"
        ? []
        : [`said.push("${column}.setup=" + [${compared("globalThis.fromSetup")}].join());`]),
      ...(hasEarlierFile
        ? [
            `for (const [name, held] of Object.entries(globalThis.kept ?? {})) said.push("${column}.is." + name + "=" + [${compared("held")}].join());`,
          ]
        : []),
    ];
  }

  function writes(handles: Handle[]) {
    const totals = handles
      .filter(handle => handle.kind !== "default")
      .map(handle => member(handle, "total"))
      .join(", ");
    return [
      `${member(handles.at(-1)!, "add")}(1);`,
      `said.push("wrote.newest=" + [${totals}].join());`,
      ...(handles.length > 1
        ? [`${member(handles[0], "add")}(10);`, `said.push("wrote.oldest=" + [${totals}].join());`]
        : []),
    ];
  }

  function spies(handles: Handle[]) {
    const namespaces = handles.filter(handle => handle.kind === "namespace");
    if (c.spy === "no-spy" || !namespaces.length) return [];
    const spiedOn = c.spy === "spy-on-oldest" ? namespaces[0] : namespaces.at(-1)!;
    const reads = [
      ...handles.map(handle => `${member(handle, "read")}()`),
      ...handles.map(handle => `${member(handle, "both")}()`),
      ...(hasHelper ? ["viaHelper()"] : []),
    ].join(", ");
    return [
      `const spy = vi.spyOn(${spiedOn.variable}, "read").mockImplementation(() => "spied");`,
      `said.push("spied=" + [${reads}].join());`,
      "spy.mockRestore();",
      `said.push("unspied=" + [${reads}].join());`,
    ];
  }

  const keepHandles = (handles: [string, Handle][]) =>
    `globalThis.kept = { ...globalThis.kept, ${handles
      .map(
        ([name, handle]) =>
          `${name}: ${handle.kind === "named" ? "{ read, add, get total() { return total; } }" : handle.variable}`,
      )
      .join(", ")} };`;

  const wrapInLoop = (line: string) =>
    line.startsWith("said.push(") && line.endsWith(");")
      ? `{ let last = [""]; for (let iteration = 0; iteration < 300; iteration++) last = [${line.slice("said.push(".length, -2)}]; said.push(...last); }`
      : line;

  function testFile(title: string, head: string[], body: string[]) {
    const readsInLoops = variant === "looped" || (variant === "shared" && title === "other");
    return [
      ...head,
      `const key = process.env.NO_SUCH_VARIABLE ?? "read";`,
      "const thrownBy = (f) => { try { f(); } catch (error) { return error; } };",
      `test("${title}", async () => {`,
      "  const said = [];",
      "  try {",
      ...(readsInLoops ? body.map(wrapInLoop) : body).map(line => "    " + line),
      "  } catch (error) {",
      `    said.push("THREW " + String(error).split("\\n")[0]);`,
      "    throw error;",
      "  } finally {",
      `    console.log("SAID ${title} " + said.join(" "));`,
      "  }",
      "});",
      "",
    ].join("\n");
  }

  function headOfMainTest() {
    return [
      runnerImport,
      ...(c.first === "named" ? [namedImport] : []),
      ...(c.first === "namespace" ? [`import * as user from "./user.mjs";`] : []),
      ...(c.first === "default" ? [`import user from "./user.mjs";`] : []),
      ...(hasHelper && c.first !== "unloaded" ? [`import { viaHelper } from "./helper.mjs";`] : []),
      ...(c.call === "vi.mock" ? [mockCall("mock", 1, "vi.mock")] : []),
    ];
  }

  function mainTest() {
    const body: string[] = [];
    const viaHelper = hasHelper ? [`said.push("helper=" + viaHelper());`] : [];
    if (c.first === "dynamic") body.push(`const user = await import("./user.mjs");`);
    if (c.first === "require") body.push(`const user = require("./user.mjs");`);
    const user: Handle | undefined =
      c.first === "unloaded"
        ? undefined
        : c.first === "named"
          ? importedNames
          : { kind: c.first === "default" ? "default" : "namespace", variable: "user" };
    const handles: [string, Handle][] = [];
    if (user) {
      handles.push(["user", user]);
      body.push(values("user", user), ...(user.kind === "namespace" ? [shape("user", user)] : []));
      body.push(...identityAcrossFiles("user", user, otherRunsBefore), ...viaHelper, reportRuns);
    }
    if (c.call !== "vi.mock") {
      body.push(mockCall("mock", 1, c.call));
      if (user) body.push(values("user.mock", user));
    }
    const mocked = namespaceIn("mocked");
    body.push(load("mocked"));
    if (hasHelper && c.first === "unloaded") body.push(`const { viaHelper } = await import("./helper.mjs");`);
    body.push(values("mocked", mocked), shape("mocked", mocked));
    if (user) body.push(identity("mocked.is.user", mocked, user), values("user.then", user));
    body.push(...identityAcrossFiles("mocked", mocked, otherRunsBefore), ...viaHelper, reportRuns);
    handles.push(["mocked", mocked]);
    if (c.after !== "stop") {
      body.push({ unmock, restore: "mock.restore();", remock: secondMock(), reset: "vi.resetModules();" }[c.after]);
      const again = namespaceIn("again");
      body.push(load("again"), values("again", again), shape("again", again));
      if (user) body.push(identity("again.is.user", again, user));
      body.push(identity("again.is.mocked", again, mocked));
      if (user) body.push(values("user.last", user));
      body.push(values("mocked.last", mocked));
      body.push(...identityAcrossFiles("again", again, otherRunsBefore), ...viaHelper, reportRuns);
      handles.push(["again", again]);
    }
    const held = handles.map(([, handle]) => handle);
    body.push(...writes(held), ...spies(held));
    if (c.preload !== "no-preload")
      body.push(
        values("setup.last", { ...namespaceIn("globalThis.fromSetup"), isHandBuilt: c.preload === "named-preload" }),
      );
    if (c.otherFile !== "no-other-file") body.push(keepHandles(handles));
    body.push(reportRuns);
    return testFile("main", headOfMainTest(), body);
  }

  function mainTestInSteps() {
    const loaded = c.reload === "imported-again" ? `await import("./user.mjs")` : `require("./user.mjs")`;
    const isOwn = `([tag]) => tag !== "setup" && !tag.includes(".")`;
    const start: string[] = [];
    if (c.preload === "namespace-preload") start.push(`instances.push(["setup", globalThis.fromSetup]);`);
    if (otherRunsBefore)
      start.push(
        `for (const [name, held] of Object.entries(globalThis.kept ?? {})) if (held.config) instances.push(["kept." + name, held]);`,
      );
    if (c.first === "namespace") start.push(`instances.push(["user", user]);`);
    if (c.first === "dynamic") start.push(`instances.push(["user", await import("./user.mjs")]);`);
    if (c.first === "require") start.push(`instances.push(["user", require("./user.mjs")]);`);
    const loadsHelperLate = hasHelper && c.first === "unloaded";
    const steps: [string, string[]][] = [["start", start]];
    if (c.call !== "vi.mock") steps.push(["mock", [mockCall("mock", 1, c.call)]]);
    steps.push([
      "mocked",
      [
        `instances.push(["mocked", ${loaded}]);`,
        ...(loadsHelperLate ? [`viaHelper = (await import("./helper.mjs")).viaHelper;`] : []),
      ],
    ]);
    if (c.after !== "stop") {
      steps.push([
        c.after,
        [{ unmock, restore: "mock.restore();", remock: secondMock(), reset: "vi.resetModules();" }[c.after]],
      ]);
      steps.push(["again", [`instances.push(["again", ${loaded}]);`]]);
    }
    steps.push(["write.newest", ["instances.at(-1)[1].add(1);"]]);
    steps.push([
      "write.oldest",
      [
        c.first === "named"
          ? "add(10);"
          : c.first === "default"
            ? "user.add(10);"
            : `instances.find(${isOwn})[1].add(10);`,
      ],
    ]);
    if (c.spy !== "no-spy") {
      const spiedOn = c.spy === "spy-on-oldest" ? `instances.find(${isOwn})[1]` : "instances.at(-1)[1]";
      steps.push(["spy", [`spy = vi.spyOn(${spiedOn}, "read").mockImplementation(() => "spied");`]]);
      steps.push(["unspy", ["spy.mockRestore();"]]);
    }
    const round = (of: string) => (isCycle ? `, ${of}round()` : "");
    const body = [
      "const instances = [];",
      "let spy;",
      ...(loadsHelperLate ? [`let viaHelper = () => "not yet";`] : []),
      "const steps = [",
      ...steps.map(([title, lines]) => `  ["${title}", async () => { ${lines.join(" ")} }],`),
      "];",
      "for (const [title, step] of steps) {",
      "  await step();",
      `  let last = [""];`,
      "  for (let iteration = 0; iteration < 300; iteration++) {",
      `    last = ["[" + title + "]"];`,
      ...(c.first === "named"
        ? [`    last.push("imports=" + [read(), seen, calls(), total, config.uses, both()${round("")}].join());`]
        : []),
      ...(c.first === "namespace"
        ? [
            `    last.push("direct=" + [user.read(), user.seen, user.calls(), user.total, user.config.uses, user.both()${round("user.")}].join());`,
          ]
        : []),
      ...(c.first === "default"
        ? [`    last.push("default=" + [user.read(), user.seen, user.calls(), user.both()].join());`]
        : []),
      ...(hasHelper ? [`    last.push("helper=" + viaHelper());`] : []),
      "    for (const [tag, instance] of instances) {",
      `      last.push(tag + "=" + [instance.read(), instance.seen, instance.calls(), instance.total, instance.config.uses, instance.both()${round("instance.")}, instance[key] === instance.read, typeof instance.read, Object.keys(instance).length].join());`,
      ...(c.first === "named"
        ? [
            `      last.push(tag + ".is.imports=" + [instance.read === read, instance.add === add, instance.Failure === Failure, instance.config === config, thrownBy(instance.fail) instanceof Failure].join());`,
          ]
        : []),
      ...(c.first === "default"
        ? [`      last.push(tag + ".is.default=" + [instance.default === user, instance.read === user.read].join());`]
        : []),
      `      for (const [otherTag, other] of instances) if (otherTag < tag) last.push(tag + ".is." + otherTag + "=" + [instance === other, instance.read === other.read, instance.default === other.default, instance.Failure === other.Failure, instance.config === other.config, thrownBy(instance.fail) instanceof other.Failure].join());`,
      "    }",
      "  }",
      `  said.push(...last, "@" + (globalThis.ran ?? []).join(""));`,
      "}",
    ];
    if (c.otherFile !== "no-other-file") {
      const user =
        c.first === "named"
          ? ", user: { read, add, get total() { return total; } }"
          : c.first === "default"
            ? ", user"
            : "";
      body.push(`globalThis.kept = { ...globalThis.kept, ...Object.fromEntries(instances.filter(${isOwn}))${user} };`);
    }
    return testFile("main", headOfMainTest(), body);
  }

  function otherTest() {
    const mocks = c.otherFile.includes("-mocks-");
    const user = c.otherFile.startsWith("named-") ? importedNames : namespaceIn("user");
    const mocked = namespaceIn("mocked");
    const again = namespaceIn("again");
    const body = [values("user", user), ...(user.kind === "namespace" ? [shape("user", user)] : [])];
    body.push(...identityAcrossFiles("user", user, otherRunsAfter), reportRuns);
    if (mocks) {
      body.push(
        mockCall("mockb", 3, "vi.doMock", "sync-factory"),
        load("mocked", "imported-again"),
        values("mocked", mocked),
        shape("mocked", mocked),
      );
      body.push(identity("mocked.is.user", mocked, user), values("user.then", user));
      body.push(...identityAcrossFiles("mocked", mocked, otherRunsAfter), reportRuns, `vi.doUnmock("${mockedPath}");`);
    }
    body.push(load("again", "imported-again"), values("again", again), identity("again.is.user", again, user));
    if (mocks) body.push(identity("again.is.mocked", again, mocked));
    body.push(...identityAcrossFiles("again", again, otherRunsAfter), reportRuns);
    body.push(...writes([user, ...(mocks ? [mocked] : []), again]));
    if (otherRunsAfter)
      body.push(
        `for (const [name, held] of Object.entries(globalThis.kept ?? {})) said.push("kept." + name + "=" + [held.read(), held.total].join());`,
      );
    body.push(keepHandles([["other", user], ...(mocks ? ([["otherMocked", mocked]] as [string, Handle][]) : [])]));
    return testFile(
      "other",
      [runnerImport, user.kind === "named" ? namedImport : `import * as user from "./user.mjs";`],
      body,
    );
  }

  const files: Record<string, string> = { "package.json": `{ "type": "module" }\n` };
  files["dep.mjs"] = [
    ...(isCycle ? [`import { read } from "./user.mjs";`] : []),
    recordRun("d"),
    `export const name = "dep";`,
    "export let hits = 0;",
    "export function bump() { return ++hits; }",
    ...(isCycle ? [`export function back() { return "back:" + read(); }`] : []),
    "",
  ].join("\n");
  const barrels: Partial<Record<Choices["target"], string>> = {
    "star-barrel": `export * from "./dep.mjs";`,
    "named-barrel": `export { name, hits, bump } from "./dep.mjs";`,
    "namespace-barrel": `export * as space from "./dep.mjs";`,
  };
  const barrel = barrels[c.target];
  // A barrel without a statement of its own has no body to run again.
  if (barrel) files["barrel.mjs"] = [barrel, recordRun("b"), ""].join("\n");
  const source = barrel ? "./barrel.mjs" : "./dep.mjs";
  const isBehindNamespace = c.target === "namespace-barrel";
  const [name, bump] = isBehindNamespace ? ["space.name", "space.bump()"] : ["name", "bump()"];
  const exported = (fn: string, parameters: string, body: string) =>
    c.style === "arrows"
      ? `export const ${fn} = (${parameters}) => { ${body} };`
      : `export function ${fn}(${parameters}) { ${body} }`;
  files["user.mjs"] = [
    isBehindNamespace
      ? `import { space } from "${source}";`
      : `import { name, bump${isCycle ? ", back" : ""} } from "${source}";`,
    recordRun("u"),
    "let count = 0;",
    "export let total = 0;",
    `export const seen = ${name};`,
    exported("read", "", `return ${name};`),
    exported("calls", "", "return ++count;"),
    exported("add", "n", "total += n; return total;"),
    exported("both", "", `return read() + ":" + ${bump};`),
    "export class Failure extends Error {}",
    "export const config = { uses: 0 };",
    `export function fail() { config.uses++; throw new Failure(${name}); }`,
    ...(isCycle ? ["export function round() { return back(); }"] : []),
    "export default { read, seen, calls, add, both };",
    "",
  ].join("\n");
  if (hasHelper)
    files["helper.mjs"] = [
      `import { read } from "./user.mjs";`,
      recordRun("h"),
      "export function viaHelper() { return read(); }",
      "",
    ].join("\n");
  files["m.test.mjs"] = variant === "shared" ? mainTestInSteps() : mainTest();
  const tests = ["./m.test.mjs"];
  if (otherRunsBefore) {
    files["a.test.mjs"] = otherTest();
    tests.unshift("./a.test.mjs");
  } else if (otherRunsAfter) {
    files["z.test.mjs"] = otherTest();
    tests.push("./z.test.mjs");
  }
  if (c.preload === "namespace-preload")
    files["setup.mjs"] = [
      `import * as user from "./user.mjs";`,
      recordRun("s"),
      "globalThis.fromSetup = user;",
      "",
    ].join("\n");
  if (c.preload === "named-preload")
    files["setup.mjs"] = [
      `import { read, seen, calls, total, add } from "./user.mjs";`,
      recordRun("s"),
      "globalThis.fromSetup = { read, calls, add, get seen() { return seen; }, get total() { return total; } };",
      "",
    ].join("\n");
  if (variant !== "straight") {
    files["zz-reset.test.mjs"] =
      `import { test, vi } from "bun:test";\ntest.skip("resets", () => { vi.resetModules(); });\n`;
    tests.push("./zz-reset.test.mjs");
  }
  const args = [...(c.preload === "no-preload" ? [] : ["--preload", "./setup.mjs"]), ...tests];
  return c.language === "typescript"
    ? { variant, name: nameOf(c), files: inTypeScript(files), args: args.map(arg => arg.replace(".mjs", ".ts")) }
    : { variant, name: nameOf(c), files, args };
}

const annotations = [
  ["function add(n) {", "function add(n: number): number {"],
  ["(n) =>", "(n: number) =>"],
  ["let count = 0;", "let count: number = 0;"],
  ["export let total = 0;", "export let total: number = 0;"],
  ["export let hits = 0;", "export let hits: number = 0;"],
  ["const said = [];", "const said: string[] = [];"],
  ["const thrownBy = (f) =>", "const thrownBy = (f: () => void): unknown =>"],
  ["function read() {", "function read(): string {"],
  ["const instances = [];", "const instances: [string, any][] = [];"],
  ["let spy;", "let spy: any;"],
  ["const steps = [", "const steps: [string, () => Promise<void>][] = ["],
  ["function viaHelper() {", "function viaHelper(): string {"],
];

function inTypeScript(files: Record<string, string>) {
  const typed: Record<string, string> = {};
  for (const [file, source] of Object.entries(files)) {
    if (!file.endsWith(".mjs")) {
      typed[file] = source;
      continue;
    }
    let annotatedSource = source.replace(/"\.\/(\w+)\.mjs"/g, `"./$1"`);
    for (const [untyped, annotated] of annotations) annotatedSource = annotatedSource.replaceAll(untyped, annotated);
    if (file === "user.mjs") annotatedSource += "export type Reader = () => string;\n";
    if (file === "m.test.mjs")
      annotatedSource = annotatedSource
        .replace(`from "bun:test";\n`, `from "bun:test";\nimport type { Reader } from "./user";\n`)
        .replace(
          "  const said: string[] = [];",
          `  const said: string[] = [];\n  const typed: Reader = () => "typed";\n  said.push(typed());`,
        );
    if (annotatedSource.includes("globalThis."))
      annotatedSource +=
        "declare global {\n  var ran: string[] | undefined;\n  var kept: Record<string, any> | undefined;\n  var fromSetup: any;\n}\n";
    typed[file.slice(0, -".mjs".length) + ".ts"] = annotatedSource;
  }
  return typed;
}

const dep = `export const name = "dep";\n`;
const user = `import { name } from "./dep.mjs";\nexport function read() { return name; }\n`;
const userBehindBarrel = {
  "barrel.mjs": `export * from "./dep.mjs";\nglobalThis.barrelRan = true;\n`,
  "dep.mjs": dep,
  "user.mjs": `import { name } from "./barrel.mjs";\nexport function read() { return name; }\n`,
};
const cycle = {
  "dep.mjs": `import { read } from "./user.mjs";\nexport const name = "dep";\nexport function back() { return "back:" + read(); }\n`,
  "user.mjs": `import { name, back } from "./dep.mjs";\nexport const seen = name;\nexport function read() { return name; }\nexport function round() { return back(); }\n`,
};
const earlierFile = `import { test } from "bun:test";\nimport { read } from "./user.mjs";\ntest("a", () => console.log("SAID a read=" + read()));\n`;
const keepsMockedInstance = `import { test, vi } from "bun:test";
test("m", async () => {
  vi.doMock("./dep.mjs", () => ({ name: "mock" }));
  globalThis.kept = await import("./user.mjs");
  console.log("SAID m kept=" + globalThis.kept.read());
});
`;

const reducedProjects: Record<string, Record<string, string>> = {
  "unmocked below a barrel": {
    ...userBehindBarrel,
    "m.test.mjs": `import { test, vi } from "bun:test";
test("m", async () => {
  vi.doMock("./dep.mjs", () => ({ name: "mock" }));
  const mocked = await import("./user.mjs");
  vi.doUnmock("./dep.mjs");
  const again = await import("./user.mjs");
  console.log("SAID m mocked=" + mocked.read(), "again=" + again.read(), "same=" + (again === mocked));
});
`,
  },
  "loaded earlier through a barrel": {
    ...userBehindBarrel,
    "a.test.mjs": earlierFile,
    "m.test.mjs": `import { test, vi } from "bun:test";
import { read } from "./user.mjs";
test("m", async () => {
  vi.doMock("./dep.mjs", () => ({ name: "mock" }));
  const mocked = await import("./user.mjs");
  console.log("SAID m mocked=" + mocked.read(), "imported=" + read(), "same=" + (mocked.read === read));
});
`,
  },
  "factory spreads the dependency": {
    "dep.mjs": `(globalThis.ran ??= []).push("dep");\nexport const name = "dep";\n`,
    "user.mjs": `import { name } from "./dep.mjs";\n(globalThis.ran ??= []).push("user");\nexport function read() { return name; }\n`,
    "a.test.mjs": earlierFile,
    "m.test.mjs": `import { test, vi } from "bun:test";
import { read } from "./user.mjs";
test("m", async () => {
  vi.doMock("./dep.mjs", async () => ({ ...(await vi.importActual("./dep.mjs")), name: "mock" }));
  const mocked = await import("./user.mjs");
  console.log("SAID m mocked=" + mocked.read(), "imported=" + read(), "same=" + (mocked.read === read), "ran=" + globalThis.ran.join());
});
`,
  },
  "factory spreads the mocked module": {
    "user.mjs": `(globalThis.ran ??= []).push("user");\nlet count = 0;\nexport function read() { return "user"; }\nexport function calls() { return ++count; }\n`,
    "a.test.mjs": `import { test } from "bun:test";\nimport { calls } from "./user.mjs";\ntest("a", () => console.log("SAID a calls=" + calls()));\n`,
    "m.test.mjs": `import { test, vi } from "bun:test";
import { calls } from "./user.mjs";
test("m", async () => {
  vi.doMock("./user.mjs", async () => ({ ...(await vi.importActual("./user.mjs")), read: () => "mock" }));
  const mocked = await import("./user.mjs");
  console.log("SAID m mocked=" + mocked.read(), "mocked.calls=" + mocked.calls(), "calls=" + calls(), "same=" + (mocked.calls === calls), "ran=" + globalThis.ran.join());
});
`,
  },
  "cycle mocked then unmocked": {
    ...cycle,
    "m.test.mjs": `import { test, vi } from "bun:test";
test("m", async () => {
  vi.doMock("./dep.mjs", () => ({ name: "mock", back: () => "mock:back" }));
  const mocked = await import("./user.mjs");
  vi.doUnmock("./dep.mjs");
  const again = await import("./user.mjs");
  console.log("SAID m mocked=" + mocked.read(), "again=" + again.read(), "seen=" + again.seen, "round=" + again.round());
});
`,
  },
  "cycle under a hoisted mock": {
    ...cycle,
    "a.test.mjs": earlierFile,
    "m.test.mjs": `import { test, vi } from "bun:test";
import { read, round } from "./user.mjs";
vi.mock("./dep.mjs", () => ({ name: "mock", back: () => "mock:back" }));
test("m", async () => {
  console.log("SAID m read=" + read(), "round=" + round());
  vi.doUnmock("./dep.mjs");
  const again = await import("./user.mjs");
  console.log("SAID m again=" + again.read(), "read=" + read(), "round=" + round(), "same=" + (again.read === read));
});
`,
  },
  "next file reads mocked instance": {
    "dep.mjs": dep,
    "user.mjs": user,
    "m.test.mjs": keepsMockedInstance,
    "z.test.mjs": `import { test } from "bun:test";
import { read } from "./user.mjs";
test("z", () => console.log("SAID z read=" + read(), "kept=" + globalThis.kept.read(), "same=" + (globalThis.kept.read === read)));
`,
  },
  "next file mocks again": {
    "dep.mjs": dep,
    "user.mjs": user,
    "m.test.mjs": keepsMockedInstance,
    "z.test.mjs": `import { test, vi } from "bun:test";
import { read } from "./user.mjs";
test("z", async () => {
  vi.doMock("./dep.mjs", () => ({ name: "second-mock" }));
  const mocked = await import("./user.mjs");
  console.log("SAID z mocked=" + mocked.read(), "read=" + read(), "same=" + (mocked.read === read));
});
`,
  },
};

/** One case in this many also runs as `looped` and as `shared`. The loops of allChoices() have even lengths and lengths of three: a stride that shares a factor with them draws one kind of case. */
const sampledOneIn = 7;

export function moduleIdentityCases(): Case[] {
  const all = allChoices();
  const sample = all.filter((_, index) => index % sampledOneIn === 0);
  for (const axis of axisNames)
    for (const word of axes[axis])
      if (!sample.some(choices => choices[axis] === word)) throw new Error(`No sampled case has ${axis} ${word}.`);
  return [
    ...Object.entries(reducedProjects).map(
      ([name, files]): Case => ({
        variant: "reduced",
        name,
        files: { "package.json": `{ "type": "module" }\n`, ...files },
        args: Object.keys(files)
          .filter(file => file.endsWith(".test.mjs"))
          .sort()
          .map(file => "./" + file),
      }),
    ),
    ...all.map(choices => projectOf(choices, "straight")),
    ...sample.map(choices => projectOf(choices, "looped")),
    ...sample.map(choices => projectOf(choices, "shared")),
  ];
}
