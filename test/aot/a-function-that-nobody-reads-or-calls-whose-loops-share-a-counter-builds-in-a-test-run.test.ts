// A test run compiles every function of the files it loads, also one that nobody reads or calls: an executable lets such a function go. Nothing at all is known of its parameters then.
// Two loops in a row share a counter, and the second reckons with a parameter (`n - i`). Looking in front of the second loop the compiler asked what is known of the counter as it leaves the first,
// found no value built under that name, and two of its questions handed it to each other without end: "error: Out of stack while compiling".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { testOneByOne as test } from "./supported";

raiseDefaultTimeout(120_000);

const files = {
  "package.json": `{ "name": "p" }`,
  "rows.cjs": `
    module.exports = {};
    function lower(a, n, r) {
      var i = Math.min(this.filled + a.filled, n);
      var j;
      for (j = r.filled - this.filled; i < j; ++i) r.digits[i + this.filled] = this.multiplyInto(0, a.digits[i], r, i, 0, this.filled);
      for (j = Math.min(a.filled, n); i < j; ++i) this.multiplyInto(0, a.digits[i], r, i, 0, n - i);
    }
    module.exports.lower = lower;`,
  "unread.test.ts": `
    import { test, expect } from "bun:test";
    import rows from "./rows.cjs";
    test("it loads", () => { expect(typeof rows).toBe("object"); });`,
  "called.test.ts": `
    import { test, expect } from "bun:test";
    import rows from "./rows.cjs";
    test("it reckons", () => {
      const seen: unknown[] = [];
      const row = { filled: 1, digits: [7], multiplyInto(...all: unknown[]) { seen.push(all[3], all[5]); return 5; } };
      const into = { filled: 3, digits: [] as number[] };
      rows.lower.call(row, { filled: 4, digits: [1, 2, 3, 4] }, 0, into);
      expect(into.digits).toEqual([, 5, 5]);
      expect(seen).toEqual([0, 1, 1, 1]);
    });`,
};

for (const file of ["unread.test.ts", "called.test.ts"]) {
  test(file, async () => {
    using dir = tempDir("a-function-that-nobody-reads-or-calls", files);
    for (const flags of [[], ["--aot"]]) {
      const { stderr, exitCode } = await run([bunExe(), "test", ...flags, `./${file}`], String(dir), bunEnv);
      expect({ flags, stderr: exitCode ? stderr : "", exitCode }).toEqual({ flags, stderr: "", exitCode: 0 });
    }
  });
}
