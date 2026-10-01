// Prototype of describe("repository") for test/cli/lint/conformance.test.ts, as a file of its own so that it runs alone in a scratch clone.
// In conformance.test.ts the constants home, small, lazy and reference exist already; the import of node:path gains basename and sep.
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import { readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";

const home = join(import.meta.dir, "conformance");
const small = isDebug || isASAN;
function lazy<T>(make: () => T): () => T {
  let made: { value: T } | undefined;
  return () => (made ??= { value: make() }).value;
}
const reference = lazy(() => JSON.parse(readFileSync(join(home, "reference_counts.json"), "utf8")));

describe("repository", () => {
  // CI lists its tests with getTests of scripts/runner.node.ts, which walks test/ and names every path from there.
  const runnerSource = lazy(() =>
    readFileSync(join(import.meta.dir, "..", "..", "..", "scripts", "runner.node.ts"), "utf8"),
  );
  // The text of a function at the top level of the runner.
  const cut = (name: string) => {
    const found = runnerSource().match(new RegExp(`^function ${name}\\(.*?^}$`, "gms")) ?? [];
    if (found.length !== 1) throw new Error(`scripts/runner.node.ts has ${found.length} functions named ${name}`);
    return found[0];
  };
  const predicates = ["isJavaScript", "isNodeTest", "isClusterTest", "isTest", "isTestStrict", "isHidden"] as const;
  // The predicates of the runner themselves, not a copy. CI on macOS x64 takes fewer files: the three constants are false.
  const rule = lazy(() => {
    const code = new Bun.Transpiler({ loader: "ts" }).transformSync(predicates.map(cut).join("\n"));
    const names = ["basename", "dirname", "sep", "isCI", "isMacOS", "isX64"];
    const make = new Function(...names, `${code}\nreturn { isTest, isHidden };`);
    const made: Record<"isTest" | "isHidden", (path: string) => boolean> = make(
      basename,
      dirname,
      sep,
      false,
      false,
      false,
    );
    // A path is given with "/" and asked as the runner has it on this platform.
    const native = (path: string) => (sep === "/" ? path : path.replaceAll("/", sep));
    return {
      isTest: (path: string) => made.isTest(native(path)),
      isHidden: (path: string) => made.isHidden(native(path)),
    };
  });
  const prefix = "cli/lint/conformance/";
  // Every file and directory of the conformance work, one per line, named from test/ with "/": one listing, and no call per name.
  const listing = lazy(() => {
    const text = prefix + (readdirSync(home, { recursive: true }) as string[]).join(`\n${prefix}`);
    return sep === "/" ? text : text.replaceAll(sep, "/");
  });
  // A path that the rule pinned below takes for a test or hides holds one of its literals: a debug build asks the rule about these paths only.
  const mayMatter =
    /^.*(?:\.test|spec\.|js\/node\/test\/parallel\/|js\/node\/test\/sequential\/|js\/bun\/test\/parallel\/|js\/node\/cluster\/test-|node_modules|node.js|\/\.).*$/gm;

  test("the rule of CI for a test below test/ is the one that this file applies", () => {
    expect([...predicates, "getTests"].map(cut).join("\n\n"))
      .toBe(String.raw`function isJavaScript(path: string): boolean {
  return /\.(c|m)?(j|t)sx?$/.test(basename(path));
}

function isNodeTest(path: string): boolean {
  // Do not run node tests on macOS x64 in CI, those machines are slow and expensive.
  if (isCI && isMacOS && isX64) {
    return false;
  }
  if (!isJavaScript(path)) {
    return false;
  }
  const unixPath = path.replaceAll(sep, "/");
  return (
    unixPath.includes("js/node/test/parallel/") ||
    unixPath.includes("js/node/test/sequential/") ||
    unixPath.includes("js/bun/test/parallel/")
  );
}

function isClusterTest(path: string): boolean {
  const unixPath = path.replaceAll(sep, "/");
  return unixPath.includes("js/node/cluster/test-") && unixPath.endsWith(".ts");
}

function isTest(path: string): boolean {
  return isNodeTest(path) || isClusterTest(path) ? true : isTestStrict(path);
}

function isTestStrict(path: string): boolean {
  return isJavaScript(path) && /\.test|spec\./.test(basename(path));
}

function isHidden(path: string): boolean {
  return /node_modules|node.js/.test(dirname(path)) || /^\./.test(basename(path));
}

function getTests(cwd: string): string[] {
  function* getFiles(cwd: string, path: string): Generator<string> {
    const dirname = join(cwd, path);
    for (const entry of readdirSync(dirname, { encoding: "utf-8", withFileTypes: true })) {
      const { name } = entry;
      const filename = join(path, name);
      if (isHidden(filename)) {
        continue;
      }
      if (entry.isFile()) {
        if (isTest(filename)) {
          yield filename;
        }
      } else if (entry.isDirectory()) {
        yield* getFiles(cwd, filename);
      }
    }
  }
  return [...getFiles(cwd, "")].sort();
}`);
  });

  test("the rule takes a test by its name or by its directory, and hides a name or a directory", () => {
    const { isTest, isHidden } = rule();
    const cases = `${prefix}corpus/cases/`;
    const taken = [
      "cli/lint/conformance.test.ts",
      `${cases}compiler/a.test.ts`,
      `${cases}compiler/a.testing.d.mts`,
      `${cases}compiler/a_spec.tsx`,
      `${cases}compiler/typespec.cjs`,
      `${cases}conformance/js/node/test/parallel/a.js`,
      `${cases}conformance/js/node/test/sequential/a.ts`,
      `${cases}conformance/js/bun/test/parallel/a.mjs`,
      `${cases}conformance/js/node/cluster/test-a.ts`,
    ];
    const notTaken = [
      `${cases}compiler/castTest.ts`,
      `${cases}compiler/typeSpec.ts`,
      `${cases}compiler/a_test.ts`,
      `${cases}conformance/js/node/cluster/test-a.js`,
      `${prefix}corpus/baselines/typescript/a.test.errors.txt`,
    ];
    const hidden = [
      `${prefix}.gitattributes`,
      `${cases}conformance/node_modules/a.ts`,
      `${cases}conformance/node/js/a.ts`,
    ];
    const notHidden = [`${cases}conformance/node/allowJs/a.ts`, `${cases}conformance/node_modules`];
    expect({
      taken: taken.filter(isTest),
      notTaken: notTaken.filter(isTest),
      hidden: hidden.filter(isHidden),
      notHidden: notHidden.filter(isHidden),
      mayMatter: [...([...taken, ...hidden].join("\n").match(mayMatter) ?? [])],
    }).toEqual({ taken, notTaken: [], hidden, notHidden: [], mayMatter: [...taken, ...hidden] });
  });

  test("CI walks every directory of the conformance work and takes none of its files for a test", () => {
    const { isTest, isHidden } = rule();
    const asked = small ? (listing().match(mayMatter) ?? []) : listing().split("\n");
    // Every directory that holds something, with its "/": an entry of the corpus that is none of these is a file.
    const directories = new Set(listing().match(/^.*\/(?=[^/\n]*$)/gm));
    const corpus = `${prefix}corpus/`;
    const ofCorpus = (listing().match(/^cli\/lint\/conformance\/corpus\/.*$/gm) ?? []).length;
    // No name of the corpus starts with a dot: sync.sh refuses one. What does is of this checkout, and is not counted.
    const dotNames = (listing().match(/^cli\/lint\/conformance\/corpus\/(?:.*\/)?\.[^/\n]*$/gm) ?? []).length;
    expect({
      takenForATest: asked.filter(isTest),
      // A file that starts with a dot is no matter: what CI must reach is every directory, and every other file.
      notWalked: asked.filter(isHidden).filter(path => directories.has(`${path}/`) || !/\/\.[^/]*$/.test(path)),
      filesOfTheCorpus:
        ofCorpus - [...directories].filter(path => path.startsWith(corpus) && path !== corpus).length - dotNames,
    }).toEqual({ takenForATest: [], notWalked: [], filesOfTheCorpus: reference().corpus.files });
  });

  test("`bun test` takes none of them either", () => {
    // Its scanner lowers the base name and takes a JavaScript or TypeScript file whose name ends, before the ending, in one of four suffixes.
    const taken = /^.*[._](?:test|spec)\.(?:[cm]?[jt]s|[jt]sx)$/gim;
    const controls = [
      "a.test.ts",
      "A_Test.TSX",
      "a.spec.mjs",
      "a_spec.cts",
      "a.test.d.ts",
      "castTest.ts",
      "a.test.txt",
    ];
    expect({
      controls: controls.map(name => `${prefix}${name}`.match(taken) !== null),
      taken: listing().match(taken) ?? [],
    }).toEqual({ controls: [true, true, true, true, false, false, false], taken: [] });
  });
});
