// `Math.floor(a / b)`, `Math.round(a / b)`, `(a / b) | 0` and their kin, where the compiler can see that both operands are
// whole numbers in a known range: a loop counter, a masked value, a length, a remainder. It may then divide as integers,
// which is only right for some signs and never for a divisor of zero. Each scene lets both ranges cross zero and prints
// every quotient, so that -0, NaN, the infinities and the rounding of negative halves show.
import type { Random } from "./random";

/** Whole numbers in a range the compiler can work out. `i` and `j` are loop counters, `a` and `b` parameters. */
const dividends = ["i", "i - 4", "(a & 15) - 8", "list.length - i", "i * 3", "-i", "a | 0", "i % 5", "a & 255", "2147483647 - i", "i * 1000003", "(i - 3) * 5", "text.length - i", "i - j"]; // prettier-ignore
const divisors = ["j", "j - 2", "(b & 7) - 3", "j + 1", "-j", "list.length", "text.length - 2", "2", "-2", "7", "j * j", "1 << j", "b | 0", "(j & 3) - 1", "j % 3", "-1"]; // prettier-ignore

/** X is the dividend and Y the divisor. */
const roundings = [
  "Math.floor(X / Y)",
  "Math.floor(X / Y)",
  "Math.round(X / Y)",
  "Math.round(X / Y)",
  "Math.trunc(X / Y)",
  "Math.ceil(X / Y)",
  "(X / Y) | 0",
  "~~(X / Y)",
  "(X / Y) >> 0",
  "(X / Y) >>> 0",
  "Math.floor(X / Y) * Y + (X % Y)",
  "Math.round(X / Y) | 0",
  "Math.floor(X / Y) % 3",
  "Math.abs(Math.round(X / Y))",
  "list[Math.floor(X / Y)] ?? -7",
  "1 / Math.round(X / Y)",
  "1 / Math.floor(X / Y)",
  "Math.floor((X / Y) * 2)",
  "Math.floor(X / Y + 0.5)",
  "Math.sign(Math.trunc(X / Y))",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const expressions = Array.from({ length: random.between(1, 3) }, () =>
      random
        .pick(roundings)
        .replaceAll("X", `(${random.pick(dividends)})`)
        .replaceAll("Y", `(${random.pick(divisors)})`),
    );
    const [iFrom, iTo] = random.pick([[0, 6], [-3, 4], [-6, 0], [1, 9], [0, 3]]); // prettier-ignore
    const [jFrom, jTo] = random.pick([[0, 4], [-2, 3], [1, 5], [-4, 0], [0, 2]]); // prettier-ignore
    scenes.push(`function scene${scene}(a${as("number")}, b${as("number")})${as("string")} {
  const out${as("string[]")} = [];
  for (let i = ${iFrom}; i <= ${iTo}; i++) {
    for (let j = ${jFrom}; j <= ${jTo}; j++) {
      ${expressions.map(expression => `out.push(shown(${expression}));`).join("\n      ")}
    }
  }
  return out.join();
}
{
  let last = "";
  for (let round = 0; round < ${random.pick([1, 1, 30, 300])}; round++) last = noted([${random
    .sample(
      ["0, 0", "5, 3", "-5, 3", "7, -2", "8, 4", "255, 7", "-1, -1", "2147483647, 1", "-2147483648, -1", "12, 0"],
      3,
    )
    .map(given => `scene${scene}(${given})`)
    .join(", ")}].join(" | "));
  console.log("scene ${scene}", last, counted());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set${typed ? "<string>" : ""}();
function noted(answer${as("string")})${as("string")} {
  rounds.add(answer);
  return answer;
}
function counted()${as("string")} {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const list = [10, 20, 30, 40];
const text = "some";
function shown(value${as("number")})${as("string")} {
  return Object.is(value, -0) ? "-0" : String(value);
}
${scenes.join("\n")}
`;
}
