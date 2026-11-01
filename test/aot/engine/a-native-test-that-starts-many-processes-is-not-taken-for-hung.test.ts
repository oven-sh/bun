// `testaot` ends a native test that has printed nothing for 100 seconds as hung. A test prints its name and then nothing, and some
// compile a program and start the shell eleven to twenty-nine times. On a slow Intel Mac those steps together took over 100
// seconds though none of them hung. So the process that runs the tests prints a line after each process that it started.
import { expect } from "bun:test";
import { test } from "../harness/declare";
import { run, whyNoTestaot } from "./testaot";

test.skipIf(whyNoTestaot !== undefined)("a line follows each process that a native test started", async () => {
  // This one starts `testaot` twice.
  const { stderr, exitCode } = await run("native", "--single-process", "child-process/exit-codes");
  expect({
    lines: stderr.split(/\r?\n/).filter(line => line === "a child process has ended").length,
    exitCode,
  }).toEqual({ lines: 2, exitCode: 0 });
});
