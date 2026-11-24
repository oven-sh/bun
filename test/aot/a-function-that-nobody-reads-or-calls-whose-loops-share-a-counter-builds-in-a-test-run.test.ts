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
    "use strict";
    // a fence is painted from its gate on as far as the pot goes, and what is left is written down by how far it stands from the pole
    function paint(fence, pole, color) {
      let board = this.gate, left = "";
      for (; board < fence.length && this.pot > 0; board++) {
        this.pot -= fence[board].length;
        fence[board] = color + fence[board];
      }
      for (; board < fence.length; board++) left += this.tell(fence[board], pole - board) + ";";
      return left;
    }
    // the same from both ends, with a counter that is one function's alone
    function trim(hedge, height) {
      let at;
      for (at = 0; at < hedge.length; at++) if (hedge[at] > height) break;
      for (; at < hedge.length; ++at) hedge[at] = Math.min(hedge[at], height - at);
      return hedge;
    }
    module.exports = { paint, trim };`,
  "unread.test.ts": `
    import { test, expect } from "bun:test";
    import rows from "./rows.cjs";
    test("it loads", () => { expect(typeof rows).toBe("object"); });`,
  "called.test.ts": `
    import { test, expect } from "bun:test";
    import rows from "./rows.cjs";
    test("it paints", () => {
      const told: unknown[] = [];
      const painter = { gate: 1, pot: 5, tell(board: string, distance: number) { told.push(distance); return board + distance; } };
      const fence = ["oak", "ash", "elm", "yew", "fir"];
      expect(rows.paint.call(painter, fence, 4, "red ")).toBe("yew1;fir0;");
      expect(fence).toEqual(["oak", "red ash", "red elm", "yew", "fir"]);
      expect(told).toEqual([1, 0]);
      expect(rows.trim([1, 2, 9, 4, 9], 5)).toEqual([1, 2, 3, 2, 1]);
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
