// What an operator gives is typed by what arrives at its operands: a number for numbers, a text as soon as a text is among them, a
// bigint for bigints, and for an object what its own members answer. Code that takes the result is compiled for that type.
//
// So each operator runs here on every pair of kinds of operands. Each pair has a function of its own, so that its operands are typed
// by that pair alone, and what the operator gives goes into a parameter of a function of its own, whose code leans on the type there:
// a value that only goes on to console.log() stays boxed all the way, and a false claim about it costs nothing.
//
// Every program must print what it prints under `bun <file>`.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned, told } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { describe, test } from "./supported";

const kinds: Record<string, string[]> = {
  small: ["0", "1", "-1", "2147483647", "-2147483648", "65536", "46341", "31", "32"],
  large: [
    "4294967296",
    "-4294967296",
    "2147483648",
    "9007199254740992",
    "-9007199254740992",
    "2305843009213693952",
    "0",
  ],
  whole: ["-0", "0 / 0", "1 / 0", "-1 / 0", "1e300", "-1e300", "4611686018427387904"],
  fraction: ["0.5", "-1.5", "1e-7", "2147483647.5", "1e-320"],
  number: ["1", "0.5", "0 / 0", "-0", "3e9"],
  text: ['""', '"1"', '"abc"', '"1.5"', '"-0"', '"0x10"', '" 7 "'],
  big: ["0n", "1n", "-1n", "18446744073709551616n", "63n"],
  odd: ["undefined", "null", "true", "false"],
  object: ["new Count(1)", "new Count(2147483647)", "new Count(0.5)", "new Text()", "new Big()", "new Plain()"],
  smallOrText: ["1", '"2"'],
  smallOrBig: ["1", "2n"],
  smallOrNothing: ["1", "undefined"],
  smallOrObject: ["1", "new Text()", "new Count(0.5)"],
};

const binary: Record<string, string> = {
  add: "+",
  subtract: "-",
  multiply: "*",
  divide: "/",
  remainder: "%",
  power: "**",
  and: "&",
  or: "|",
  xor: "^",
  left: "<<",
  right: ">>",
  unsigned: ">>>",
};

const unary: Record<string, string> = {
  negate: "const r = -a;",
  numeric: "const r = +a;",
  flip: "const r = ~a;",
  increment: "let r = a; r++;",
  decrement: "let r = a; r--;",
  before: "let c = a; const r = c++;",
};

const prelude = `const lines = [];
const report = value => { lines.push(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Count { constructor(n) { this.n = n; } valueOf() { return this.n; } }
class Text { valueOf() { return "s"; } }
class Big { valueOf() { return 5n; } }
class Plain { }`;
const consumer = (name: string) =>
  `function ${name}(n) { report(typeof n); report("" + n); report("" + n * n); report("" + -n); report(n === n); report(n > 5); let m = n; m++; report("" + m); try { report(n | 0); report(1 / n); report(n % 1); report(n + 0.5); report(n > 2147483647); } catch (error) { report("threw"); } }`;
const end = 'console.log(lines.join("\\n"));\n';

// A bigint of that many bits is refused, or takes minutes.
const isTooLargeAsExponent = (sign: string, value: string) =>
  (sign === "**" || sign === "<<") && value === "18446744073709551616n";

const programs: Record<string, string> = {};
for (const [name, sign] of Object.entries(binary)) {
  const text = [prelude];
  for (const [left, lefts] of Object.entries(kinds)) {
    for (const [right, rights] of Object.entries(kinds)) {
      const pair = `${name}_${left}_${right}`;
      text.push(consumer(`told_${pair}`));
      text.push(`function ${pair}(a, b) { try { told_${pair}(a ${sign} b); } catch (error) { report("threw"); } }`);
      for (const a of lefts) {
        if (sign === "**" && isTooLargeAsExponent(sign, a)) continue;
        for (const b of rights) if (!isTooLargeAsExponent(sign, b)) text.push(`${pair}(${a}, ${b});`);
      }
    }
  }
  programs[name] = [...text, end].join("\n");
}
{
  const text = [prelude];
  for (const [name, statements] of Object.entries(unary)) {
    for (const [kind, values] of Object.entries(kinds)) {
      const one = `${name}_${kind}`;
      text.push(consumer(`told_${one}`));
      text.push(`function ${one}(a) { try { ${statements} told_${one}(r); } catch (error) { report("threw"); } }`);
      for (const a of values) text.push(`${one}(${a});`);
    }
  }
  programs.unary = [...text, end].join("\n");
}

const dir = tempDir(
  "aot-every-operator",
  Object.fromEntries(Object.entries(programs).map(([name, text]) => [`${name}.js`, text])),
);
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);

describe.concurrent("an operator gives what it gives under plain Bun, whatever kinds its operands are of", () => {
  for (const name of Object.keys(programs)) {
    test(name, async () => {
      const executable = join(folder, isWindows ? `${name}.exe` : name);
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", `./${name}.js`, "--outfile", executable],
          folder,
          bunEnv,
        ),
      );
      const [compiled, plain] = await Promise.all([
        spawned([executable], folder, bunEnv),
        spawned([bunExe(), `./${name}.js`], folder, bunEnv),
      ]);
      expect(plain.stdout.split("\n").length).toBeGreaterThan(4000);
      const expected = plain.stdout.split("\n");
      const differing = compiled.stdout
        .split("\n")
        .flatMap((line, index) =>
          line === expected[index] ? [] : [`line ${index + 1}: ${line} and not ${expected[index]}`],
        );
      expect(differing.slice(0, 20)).toEqual([]);
      expect(told(compiled)).toEqual(told(plain));
    });
  }
});
