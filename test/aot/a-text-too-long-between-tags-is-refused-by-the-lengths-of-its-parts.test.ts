import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Both texts are ropes. The lengths of the parts say that the result would be too long, so no part is written out.
const files = {
  "main.mjs": `
    let half = "x";
    let most = "";
    for (let i = 0; i < 30; i++) {
      most += half;
      half += half;
    }
    most += half; // half has 2 ** 30 characters, most 2 ** 31 - 1, as many as a text may have
    const say = (name, make) => {
      let seen = "";
      for (let turn = 0; turn < 2; turn++) {
        try {
          seen += " " + make(half, half);
        } catch (error) {
          seen += " " + error.constructor.name;
        }
      }
      console.log(name + seen);
    };
    for (const name of ["anchor", "link", "fontcolor", "fontsize"]) {
      say(name, (a, b) => a[name](b));
      say(name + " of a short text", () => "x"[name](most));
      say(name + " by a short text", () => most[name]("x"));
    }
    for (const name of ["big", "blink", "bold", "fixed", "italics", "small", "strike", "sub", "sup"])
      say(name, () => most[name]());
    say("what is asked", (a, b) => {
      const asked = [];
      try {
        String.prototype.anchor.call(
          { toString: () => (asked.push("text"), a) },
          { toString: () => (asked.push("name"), b) },
        );
      } catch (error) {
        asked.push(error.constructor.name);
      }
      return asked.join(", ");
    });
    console.log('a"b'.anchor('c"d'), "x".bold(), "丂".link("七"), "x".fontsize(7), "x".anchor());
    console.log("under a gigabyte:", process.resourceUsage().maxRSS < 1024 * 1024);
  `,
};

const refused = ["anchor", "link", "fontcolor", "fontsize"]
  .flatMap(name => [name, name + " of a short text", name + " by a short text"])
  .concat(["big", "blink", "bold", "fixed", "italics", "small", "strike", "sub", "sup"]);
const expected = [
  ...refused.map(name => name + " RangeError RangeError"),
  "what is asked text, name, RangeError text, name, RangeError",
  '<a name="c&quot;d">a"b</a> <b>x</b> <a href="七">丂</a> <font size="7">x</font> <a name="undefined">x</a>',
  "under a gigabyte: true",
  "",
];

test("a method that puts a text between tags refuses one that would be too long, and the process stays small", async () => {
  using dir = tempDir("aot-text-too-long-between-tags", files);
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], String(dir));
  expect({
    stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ stderr: [], exitCode: 0 });
  for (const command of [[bunExe(), "main.mjs"], [executable]]) {
    const ran = await run(command, String(dir));
    expect({ stdout: ran.stdout.split("\n"), stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
      stdout: expected,
      stderr: "",
      exitCode: 0,
    });
  }
}, 240_000);
