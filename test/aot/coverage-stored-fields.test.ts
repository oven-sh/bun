// The initializer of a field counts as covered, also where the constructor stores over its value.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const classes = `export class Base {
  number = 3;
  text = "x";
  list = [];
  record = {
    a: 1,
  };
  method = () => {
    return 1;
  };
  #hidden = 4;
  untouched = 5;
  constructor(value) {
    this.number = value;
    this.text = value;
    this.list = value;
    this.record = value;
    this.method = value;
    this.#hidden = value;
  }
  get hidden() {
    return this.#hidden;
  }
}
export class Derived extends Base {
  first = 6;
  second = "y";
  third = null;
  constructor(value) {
    super(value);
    this.first = value;
    this.second = value;
  }
}
export class Throws {
  first = 7;
  second = 8;
  constructor(value) {
    if (value === 1) throw new Error("one");
    this.first = value;
  }
}
`;
const files = {
  "classes.js": classes,
  "classes.test.js": `import { expect, test } from "bun:test";
import { Base, Derived, Throws } from "./classes.js";
test("classes", () => {
  for (let i = 0; i < 3; i++) {
    expect([new Base(i).hidden, new Derived(i).first]).toEqual([i, i]);
    try {
      new Throws(i);
    } catch {}
  }
});
`,
  "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\n`,
};

async function report(flags: string[]) {
  using directory = tempDir("aot-coverage-stored-fields", files);
  const { stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "--coverage", "--coverage-reporter=lcov"],
    String(directory),
    bunEnv,
  );
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
  return readFileSync(join(String(directory), "coverage", "lcov.info"), "utf8");
}

test("a compiled run counts initializers that the constructor stores over", async () => {
  const [plain, compiled] = await Promise.all([report([]), report(["--aot"])]);
  expect(plain).toContain("DA:2,");
  expect(compiled).toBe(plain);
});
