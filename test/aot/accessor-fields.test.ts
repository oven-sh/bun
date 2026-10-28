import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: { strict: true, target: "esnext", module: "preserve", moduleResolution: "bundler" },
  }),
  "hidden.ts": `
    export class Hidden {
      accessor #value = 3;
      double() { this.#value *= 2; return this.#value; }
    }
  `,
  "main.ts": `
    import { Hidden } from "./hidden";
    const key = "computed";
    const order: string[] = [];
    const noted = <T,>(name: string, value: T) => (order.push(name), value);
    class Counter {
      before = noted("before", 1);
      accessor count = noted("count", 0);
      after = noted("after", 2);
      static accessor made = 0;
      accessor [key] = "by a computed key";
      constructor() { Counter.made++; }
    }
    class Named extends Counter {
      accessor name: string;
      constructor(name: string) { super(); this.name = name; }
      override get count() { return super.count + 100; }
      override set count(value: number) { super.count = value * 2; }
    }
    const counter = new Counter();
    counter.count += 5;
    console.log(counter.count, Counter.made, counter[key], order.join());
    console.log(Object.keys(counter).join(), Object.getOwnPropertyNames(Counter.prototype).join(), Object.getOwnPropertyNames(Counter).includes("made"));
    const described = Object.getOwnPropertyDescriptor(Counter.prototype, "count")!;
    console.log(typeof described.get, typeof described.set, described.enumerable, described.configurable);
    const named = new Named("first");
    named.count = 4;
    console.log(named.name, named.count, Counter.made, Object.keys(named).join());
    try {
      described.get!.call({});
    } catch (error) {
      console.log((error as Error).constructor.name);
    }
    console.log(new Hidden().double());
  `,
};

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

test("`accessor` fields without a decorator in the file, as without --aot", async () => {
  using dir = tempDir("accessor-fields", files);
  const answers = [];
  for (const flags of [[], ["--aot"]]) {
    const outfile = join(String(dir), "out" + flags.length + (isWindows ? ".exe" : ""));
    const built = await run(String(dir), [bunExe(), "build", "--compile", ...flags, "./main.ts", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    answers.push(await run(String(dir), [outfile]));
  }
  expect(answers[0].stdout.split("\n")).toEqual([
    "5 1 by a computed key before,count,after",
    "before,after constructor,count,computed true",
    "function function false true",
    "first 108 2 before,after",
    "TypeError",
    "6",
    "",
  ]);
  expect(answers[1]).toEqual(answers[0]);
}, 120_000);
