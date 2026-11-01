import { aotBuiltinEntries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GeneratorError } from "../../../src/codegen/builtins/declarations";
import {
  formatAttributes,
  formatOwnProperties,
  isListableName,
  parseOwnProperties,
  type OwnProperty,
  type OwnPropertyLine,
} from "../../../src/codegen/builtins/own-properties";
import { memberPathOf, parsePath, textOfPath } from "../../../src/codegen/builtins/paths";
import { test } from "../supported";

const dataFile = join(import.meta.dir, "../../../src/codegen/builtins/data/own-properties.txt");
const text = readFileSync(dataFile, "utf8");
const lines = parseOwnProperties(text);

const table = aotBuiltinEntries();
const entriesByPath = new Map(table.entries.map(entry => [entry.path, entry]));

// No JavaScript reaches these objects. aotBuiltinMismatches() compares their lines with the realm in C++.
const unreachableHolders: ReadonlySet<string> = new Set(["%AsyncFromSyncIterator%.prototype"]);

const fixture = Bun.spawnSync({
  cmd: [bunExe(), join(import.meta.dir, "own-properties.fixture.js"), ...lines.map(line => line.holder)],
  env: bunEnv,
});
if (fixture.exitCode !== 0) throw new Error(`fixture exited with ${fixture.exitCode}: ${fixture.stderr}`);

const seenObjects = new Map<string, Map<string, string> | null>(
  Object.entries(JSON.parse(fixture.stdout.toString()) as Record<string, Record<string, string> | null>).map(
    ([path, properties]) => [path, properties && new Map(Object.entries(properties))],
  ),
);

function parseSeenAttributes(seen: string): OwnProperty["attributes"] {
  return { isAccessor: seen.includes("a"), isWritable: seen.includes("w"), isConfigurable: seen.includes("c") };
}

// The engine defines these on the global object only under an option or in a build for its own developers.
const isForDevelopers = (holder: string, name: string) =>
  holder === "globalThis" && (name === "$vm" || name === "Loader" || name === "gc" || name.startsWith("__"));
// Windows has no users and groups by number.
const isForPosix = (holder: string, name: string) =>
  isWindows && holder === "process" && /^(?:[gs]ete?[ug]id|[gs]etgroups|initgroups)$/.test(name);

// A line gains the names that nothing declares, loses the names that are gone, and keeps what somebody wrote by hand.
function updateLine(line: OwnPropertyLine, seen: Map<string, string>): OwnPropertyLine {
  const listed = new Map(line.properties.map(property => [property.name, property]));
  const listable = [...seen.keys()].filter(isListableName);
  const isDeclared = (name: string) => entriesByPath.has(textOfPath(parsePath(memberPathOf(line.holder, name))));
  const kept = line.properties.filter(
    ({ name, isCreatedInSomeRuns }) =>
      isCreatedInSomeRuns || (!seen.has(name) && (isForDevelopers(line.holder, name) || isForPosix(line.holder, name))),
  );
  const names = listable.filter(
    name => (listed.has(name) || (!line.isOpen && !isDeclared(name))) && !kept.some(property => property.name === name),
  );
  const properties = [
    ...names.map(name => ({
      name,
      attributes: listed.get(name)?.attributes === null ? null : parseSeenAttributes(seen.get(name)!),
      isCreatedInSomeRuns: false,
    })),
    ...kept,
  ];
  return { ...line, isOpen: line.isOpen || listable.length < seen.size, properties };
}

function updateLines(
  written: readonly OwnPropertyLine[],
  seenByHolder: ReadonlyMap<string, Map<string, string> | null>,
): OwnPropertyLine[] {
  return written.flatMap(line => {
    const seen = seenByHolder.get(line.holder);
    if (seen) return [updateLine(line, seen)];
    return unreachableHolders.has(line.holder) ? [line] : [];
  });
}

function collectFailures(check: (line: OwnPropertyLine, seen: Map<string, string>) => string[]): string[] {
  return lines.flatMap(line => {
    const seen = seenObjects.get(line.holder);
    return seen ? check(line, seen) : [];
  });
}

if (process.env.AOT_BUILTINS_UPDATE) {
  test("own-properties.txt is updated from the Bun under test", () => {
    const updatedText = formatOwnProperties(updateLines(lines, seenObjects));
    if (updatedText !== text) writeFileSync(dataFile, updatedText);
  });
} else {
  test("every holder exists", () => {
    const missing = lines.filter(line => !seenObjects.get(line.holder) && !unreachableHolders.has(line.holder));
    expect(missing.map(line => `${line.holder}: there is no such object`)).toEqual([]);
  });

  test("every holder that is exempt from the comparison has a line, and JavaScript does not reach it", () => {
    const holders = new Set(lines.map(line => line.holder));
    expect([...unreachableHolders].filter(holder => !holders.has(holder) || seenObjects.get(holder))).toEqual([]);
  });

  test("every listed property exists", () => {
    const failures = collectFailures((line, seen) =>
      line.properties
        .filter(
          ({ name, isCreatedInSomeRuns }) =>
            !seen.has(name) &&
            !isCreatedInSomeRuns &&
            !isForDevelopers(line.holder, name) &&
            !isForPosix(line.holder, name),
        )
        .map(({ name }) => `${line.holder}.${name}: is missing`),
    );
    expect(failures).toEqual([]);
  });

  test("every stated attribute matches", () => {
    const failures = collectFailures((line, seen) =>
      line.properties.flatMap(property => {
        const observed = seen.get(property.name);
        const listed = formatAttributes(property.attributes);
        if (observed === undefined || listed === "?" || observed === listed) return [];
        return [`${line.holder}.${property.name}: is ${observed}, the file says ${listed}`];
      }),
    );
    expect(failures).toEqual([]);
  });

  // The table has the properties of the line and the members that Bun's sources declare.
  test("the table has every own property of a holder whose line is closed", () => {
    const failures = collectFailures((line, seen) => {
      if (line.isOpen) return [];
      const pathOf = (name: string) => textOfPath(parsePath(memberPathOf(line.holder, name)));
      const unlisted = [...seen.keys()].filter(name => !entriesByPath.has(pathOf(name)));
      return unlisted.map(name => `${line.holder}.${name}: is neither declared nor in the file`);
    });
    expect(failures).toEqual([]);
  });
}

test("parseOwnProperties rejects malformed text", () => {
  for (const malformed of [
    "Array : b/wc a/wc\n",
    "Array : a/aw\n",
    "Array : a/\n",
    "B :\nA :\n",
    "A :",
    "A : @@?x/wc\n",
    "A : @@nodejs.util.inspect.custom/wc\n",
    "A : @@@/wc\n",
  ]) {
    expect(() => parseOwnProperties(malformed)).toThrow(GeneratorError);
    expect(() => parseOwnProperties(malformed)).toThrow(/^the list of own properties, line \d+: /);
  }
});

test("update mode marks a line open when a key cannot be listed", () => {
  const seen = new Map([
    ["@@?unregistered", "wc"],
    ["@@@registered", "wc"],
    ["@@iterator", "wc"],
    ["added", "ac"],
    ["changed", "wc"],
  ]);
  const [closed, open] = parseOwnProperties("A : @@iterator/? changed/w\nB open : @@iterator/? changed/w\n");
  expect(formatOwnProperties([updateLine(closed, seen)])).toBe(
    "A open : @@@registered/wc @@iterator/? added/ac changed/wc\n",
  );
  expect(formatOwnProperties([updateLine(open, seen)])).toBe("B open : @@iterator/? changed/wc\n");
  seen.delete("@@?unregistered");
  expect(formatOwnProperties([updateLine(closed, seen)])).toBe(
    "A : @@@registered/wc @@iterator/? added/ac changed/wc\n",
  );
});

test("update mode keeps the line of a holder that JavaScript does not reach, and drops the line of any other missing holder", () => {
  const written = parseOwnProperties("%AsyncFromSyncIterator%.prototype : next/wc\nA : a/wc\nB : b/wc\n");
  const seenByHolder = new Map<string, Map<string, string> | null>([
    ["%AsyncFromSyncIterator%.prototype", null],
    ["A", null],
    ["B", new Map([["c", "wc"]])],
  ]);
  expect(formatOwnProperties(updateLines(written, seenByHolder))).toBe(
    "%AsyncFromSyncIterator%.prototype : next/wc\nB : c/wc\n",
  );
});

test("formatOwnProperties sorts and parses back", () => {
  const property = (name: string, attributes: OwnProperty["attributes"]) => ({ name, attributes });
  const accessor = { isAccessor: true, isWritable: false, isConfigurable: true };
  const frozen = { isAccessor: false, isWritable: false, isConfigurable: false };
  const unsorted = [
    { holder: "b", isOpen: false, properties: [property("z", null), property("@@iterator", accessor)] },
    { holder: "a", isOpen: true, properties: [property("__proto__", frozen)] },
  ];
  const formatted = formatOwnProperties(unsorted);
  expect(formatted).toBe("a open : __proto__/-\nb : @@iterator/ac z/?\n");
  expect(formatOwnProperties(parseOwnProperties(formatted))).toBe(formatted);
  expect(formatOwnProperties(lines)).toBe(text);
});

const listedProperties = lines.flatMap(line =>
  line.properties.map(({ name, attributes }) => ({
    attributes,
    path: textOfPath(parsePath(memberPathOf(line.holder, name))),
  })),
);
const pathsOf = (items: readonly { path: string }[]) => items.map(item => item.path);

test("the file covers the locked objects", () => {
  expect(lines.length).toBeGreaterThan(150);
  const closedHolders = new Set(lines.filter(line => !line.isOpen).map(line => line.holder));
  const locked = table.entries.filter(
    ({ flags }) => flags.includes("IsLockedObject") || flags.includes("HasLockedMembers"),
  );
  expect(locked.length).toBeGreaterThan(50);
  expect(pathsOf(locked).filter(path => !closedHolders.has(path))).toEqual([]);
});

test("the entry of a holder lists all members unless its line is open", () => {
  const failures = lines.filter(
    line => entriesByPath.get(line.holder)?.flags.includes("ListsAllMembers") !== !line.isOpen,
  );
  expect(failures.map(line => line.holder)).toEqual([]);
  expect(lines.filter(line => line.isOpen).map(line => line.holder)).toContain("globalThis");
});

test("every listed property has an entry", () => {
  expect(pathsOf(listedProperties).filter(path => !entriesByPath.has(path))).toEqual([]);
});

test("an entry is an accessor where the file says so, and nowhere else", () => {
  const stated = listedProperties.filter(({ attributes }) => attributes !== null);
  expect(stated.filter(({ attributes }) => attributes!.isAccessor).length).toBeGreaterThan(100);
  expect(
    pathsOf(
      stated.filter(
        ({ path, attributes }) => (entriesByPath.get(path)?.kind === "Accessor") !== attributes!.isAccessor,
      ),
    ),
  ).toEqual([]);
});

test("a property that is neither writable, configurable nor an accessor is always locked", () => {
  const fixed = listedProperties.filter(({ attributes }) => formatAttributes(attributes) === "-");
  expect(fixed.length).toBeGreaterThan(100);
  expect(pathsOf(fixed.filter(({ path }) => entriesByPath.get(path)?.mutability !== "AlwaysLocked"))).toEqual([]);
});

test("every listed property has a valid Rust token", () => {
  const tokens = listedProperties.flatMap(({ path }) => entriesByPath.get(path)?.token ?? []);
  expect(tokens.length).toBe(listedProperties.length);
  expect(tokens.filter(token => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(token))).toEqual([]);
  expect(new Set(tokens).size).toBe(tokens.length);
});

test("globalThis.globalThis is the global object", () => {
  expect(lines.find(line => line.holder === "globalThis")?.properties.map(property => property.name)).toContain(
    "globalThis",
  );
  expect(textOfPath(parsePath(memberPathOf("globalThis", "globalThis")))).toBe("globalThis");
  const named = table.entries.filter(entry => entry.name === "globalThis");
  expect(named.map(({ path, flags }) => ({ path, isGlobalObject: flags.includes("IsGlobalObject") }))).toEqual([
    { path: "globalThis", isGlobalObject: true },
  ]);
});
