// A handler that never looks at what it catches may be given nothing. Every other way out of a refusal carries the whole error.
import type { Schema } from "bun";
import { validate } from "bun:bundle";

type Line = { sku: string & Schema.MinLength<1>; quantity: number & Schema.Int & Schema.Min<1> };

const wrong: unknown = JSON.parse('{"sku":"a","quantity":0}');
const wrongText = '{"sku":"","quantity":1}';
const brokenText = '{"sku":"","quantity":1';

function check(value: unknown): Line {
  return validate<Line>(value);
}

function parse(text: string): Line {
  return JSON.parse<Line>(text);
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return "no error: " + String(error);
  return error.name + ": " + error.message + " | " + ((error as any).issues?.length ?? "no issues");
}

function ignored(run: () => unknown): string {
  try {
    run();
    return "returned";
  } catch {
    return "caught";
  }
}

function lookedAt(run: () => unknown): string {
  try {
    run();
    return "returned";
  } catch (error) {
    return describe(error);
  }
}

function destructured(run: () => unknown): string {
  try {
    run();
    return "returned";
  } catch ({ message }: any) {
    return message;
  }
}

function ignoredInsideLookedAt(run: () => unknown): string {
  try {
    try {
      run();
    } catch {
      return "inner";
    }
    return "returned";
  } catch (error) {
    return describe(error);
  }
}

function lookedAtInsideIgnored(run: () => unknown): string {
  try {
    try {
      run();
    } catch (error) {
      return describe(error);
    }
    return "returned";
  } catch {
    return "outer";
  }
}

function throughFinally(run: () => unknown, log: string[]): string {
  try {
    try {
      run();
    } finally {
      log.push("finally");
    }
    return "returned";
  } catch (error) {
    return describe(error);
  }
}

function finallyUnderIgnored(run: () => unknown, log: string[]): string {
  try {
    try {
      run();
    } finally {
      log.push("finally");
    }
    return "returned";
  } catch {
    return "caught";
  }
}

function thrownAgain(run: () => unknown): string {
  try {
    try {
      run();
    } catch (error) {
      throw error;
    }
    return "returned";
  } catch (error) {
    return describe(error);
  }
}

function bothInOneFunction(value: unknown, text: string): string {
  let result = "";
  for (let i = 0; i < 3; i++) {
    try {
      validate<Line>(value);
    } catch {
      result += "-";
    }
    try {
      validate<Line>(value);
    } catch (error) {
      result += describe(error) + ";";
    }
    try {
      JSON.parse<Line>(text);
    } catch {
      result += "-";
    }
    try {
      JSON.parse<Line>(text);
    } catch (error) {
      result += describe(error) + ";";
    }
  }
  return result;
}

function* generate(value: unknown) {
  yield 1;
  yield validate<Line>(value);
}

async function checkLater(value: unknown): Promise<Line> {
  await null;
  return validate<Line>(value);
}

async function checkAtOnce(text: string): Promise<Line> {
  return JSON.parse<Line>(text);
}

async function awaitsUnderIgnored(value: unknown): Promise<string> {
  try {
    await checkLater(value);
    return "returned";
  } catch {
    return "caught";
  }
}

const runs: [string, () => unknown][] = [
  ["validate", () => validate<Line>(wrong)],
  ["validate in a function", () => check(wrong)],
  ["parse", () => JSON.parse<Line>(wrongText)],
  ["parse in a function", () => parse(wrongText)],
  ["a text that is broken behind the refusal", () => JSON.parse<Line>(brokenText)],
  ["in a callback of a built-in", () => [wrong].map(check)],
  ["in a callback of sort", () => [wrong, wrong].sort((a, b) => check(a).quantity - check(b).quantity)],
  ["in a getter", () => ({ get line() { return check(wrong); } }).line],
  ["in a constructor", () => new (class { line = check(wrong); })()],
  ["in a generator", () => [...generate(wrong)]],
  ["in a reviver", () => JSON.parse("[1]", () => check(wrong))],
  ["in toString", () => String({ toString: () => check(wrong).sku })],
];

for (let round = 0; round < 3; round++) {
  for (const [name, run] of runs) {
    const log: string[] = [];
    console.log(
      [
        name,
        ignored(run),
        lookedAt(run),
        destructured(run),
        ignoredInsideLookedAt(run),
        lookedAtInsideIgnored(run),
        throughFinally(run, log),
        finallyUnderIgnored(run, log),
        thrownAgain(run),
        log.join(),
      ].join("\n  "),
    );
  }
}
console.log(bothInOneFunction(wrong, wrongText));

console.log(await checkLater(wrong).then(() => "fulfilled", describe));
console.log(await checkAtOnce(wrongText).then(() => "fulfilled", describe));
console.log(await checkAtOnce(wrongText).catch(() => "caught"));
console.log(await awaitsUnderIgnored(wrong));
console.log((await Promise.allSettled([checkLater(wrong), checkAtOnce(wrongText)])).map(result => describe((result as PromiseRejectedResult).reason)).join("\n"));
console.log(await new Promise(resolve => queueMicrotask(() => resolve(lookedAt(() => check(wrong))))));
console.log(await new Promise(resolve => setTimeout(() => resolve(ignored(() => check(wrong)) + " " + lookedAt(() => parse(wrongText))), 0)));

process.on("uncaughtException", (error: unknown) => {
  console.log("nobody caught " + describe(error));
});
setTimeout(() => check(wrong), 0);
setTimeout(() => parse(wrongText), 0);
process.on("unhandledRejection", (error: unknown) => {
  console.log("nobody handled " + describe(error));
});
checkLater(wrong);
