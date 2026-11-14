// A loop carries a whole number from turn to turn: a counter under a bound, a counter that no test bounds, a product, a sum.
// The compiler may keep it as a 32-bit integer and drop the test after each step. Each scene starts the number near a limit
// (2^31, 2^32, 2^53, 0, -0), steps it by a constant that may cross the limit, bounds it by a constant, a length or a value
// nobody knows, and uses it with the operators that behave differently for integers: %, /, |, >>>, Math.imul, an index.
import type { Random } from "./random";

const starts = ["0", "1", "-1", "2147483640", "2147483647", "-2147483648", "-2147483640", "4294967290", "1073741820", "9007199254740985", "-0", "0.5", "limit - 5", "limit"]; // prettier-ignore
const steps = ["i++", "i += 1", "i += 2", "i += 3", "i--", "i -= 2", "i += 1073741824", "i *= 2", "i = i * 3 + 1", "i += step", "i += 0.5", "i = (i + 1) | 0", "i = (i + 1) >>> 0"]; // prettier-ignore

/** Tests that keep the loop going. `turns` also bounds every loop, so that none runs for long. */
const tests = [
  "i < limit",
  "i <= limit",
  "i !== limit",
  "i < 2147483647",
  "i <= 2147483647",
  "i > -2147483648",
  "i * i <= limit",
  "i < text.length",
  "i < list.length + 2147483640",
  "true",
  "i >= 0",
  "i < unknown",
];

/** Statements that use the number and change `sum`. */
const uses = [
  "sum += i % 7;",
  "sum += limit % i;",
  "sum += (i / 2) | 0;",
  "sum ^= i | 0;",
  "sum += i >>> 28;",
  "sum += Math.imul(i, 3) % 11;",
  "sum += list[i & 3];",
  "sum += list[i] ?? 1;",
  "sum += text.charCodeAt(i) || 0;",
  "sum += i > 2147483647 ? 1 : 0;",
  "sum += Object.is(i, -0) ? 100 : 0;",
  "sum += Number.isInteger(i) ? 0 : 1000;",
  "last = i;",
  "sum += i - 2147483640;",
  "sum += String(i).length;",
  "if (limit % i === 0) sum++;",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const used = random.sample(uses, random.between(1, 3)).join("\n    ");
    const shape = random.pick([
      "for (let i = START; TEST && turns < MOST; STEP) {\n    turns++;\n    USES\n  }",
      "let i = START;\n  while (TEST && turns < MOST) {\n    turns++;\n    USES\n    STEP;\n  }",
      "let i = START;\n  do {\n    turns++;\n    USES\n    STEP;\n  } while (TEST && turns < MOST);",
      "for (let i = START; TEST; STEP) {\n    if (++turns > MOST) break;\n    USES\n  }",
    ]);
    scenes.push(`function scene${scene}(limit${as("number")}, step${as("number")}, unknown${as("number")})${as("string")} {
  let sum = 0;
  let last = 0;
  let turns = 0;
  ${shape
    .replace("START", random.pick(starts))
    .replace("TEST", random.pick(tests))
    .replace("STEP", random.pick(steps))
    .replace("MOST", random.pick(["12", "40", "300"]))
    .replace("USES", used)}
  return [sum, Object.is(last, -0) ? "-0" : last, turns].join(":");
}
console.log("scene ${scene}", [${random
      .sample(
        ["10", "2147483647", "2147483648", "-2147483648", "4294967296", "100", "0", "49", "9007199254740991", "2.5"],
        3,
      )
      .map(
        limit =>
          `scene${scene}(${limit}, ${random.pick(["1", "2", "1073741824", "0.5", "-1"])}, ${random.pick(["5", "2147483650", "NaN", "Infinity"])})`,
      )
      .join(", ")}].join(" | "));`);
  }
  return `const list = [1, 2, 3, 4];
const text = "some text of a few words";
${scenes.join("\n")}
`;
}
