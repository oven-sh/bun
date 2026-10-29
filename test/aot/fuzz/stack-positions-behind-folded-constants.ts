// Writes functions that declare a chain of variables, each computed from the one before, and end in a statement that throws at the last of them. Bun's transpiler prints
// a literal in place of most of these names, so the line and column of the frame are those of whatever expression the literal took its position from.
//
// Each variable is used by the next declaration. No name stands where folding removes it (an arm of `?:`, the right of `&&`, the left of a comma), so every compiler counts its uses alike.
// Where the chain is not a prefix of `const` statements, each initializer is an operator: the transpiler visits only those again once it has printed a variable's initializer in them.
// A chain ends at the first operator that the transpiler leaves as it is, such as `true + 1`, `NaN < 1` or `"é" + "y"`, and nothing then asks whether that value is true.
import type { Random } from "./random";

const literals = ["1", "0", "2.5", "-3", '"x"', '""', '"5"', '"é"', "true", "false", "null", "undefined", "Infinity", "NaN", "`t`", "void 0"];
const arithmetic = ["-", "*", "/", "%", "**", "|", "&", "^", "<<", ">>", ">>>"];
const relations = ["<", "<=", ">", ">="];
const equalities = ["==", "!=", "===", "!=="];
const logical = ["&&", "||", "??"];

const usesOfAnyValue = [
  "return X();",
  "return X.p.q;",
  "return new X();",
  'return (X + "t")();',
  "return 1 in X;",
  "return 1 instanceof X;",
  "return (-X)();",
  "return (typeof X)();",
  "return (X + 1)();",
  "return (1 + X)();",
  'return ("t" + X)();',
  "return (X === 1)();",
  "X();",
  "throw X();",
  "return pass(X)();",
  "return [...X];",
  "return (1, X)();",
];
const usesOfLiterals = [
  ...usesOfAnyValue,
  "return (X ? null : undefined).p;",
  "return (X && null).p;",
  "return (X || null).p;",
  "return (X ?? null).p;",
  "return (!X)();",
  'return (given + X + "t")();',
  "return `${X}`();",
  "if (X) null.p; else undefined.q;",
];

type Value = number | string | boolean | null | undefined;
const valueOf = (text: string): Value => new Function(`return (${text});`)();
const isWide = (value: Value) => typeof value === "string" && /[^\0-\x7f]/.test(value);
const isNullish = (value: Value) => value === null || value === undefined;
const isSafe = (value: number) => Math.abs(value) <= Number.MAX_SAFE_INTEGER;

interface Step {
  text: string;
  /** Whether the transpiler prints a literal for it, given that it prints one for the variable before. */
  isFolded: boolean;
  /** `+` made it out of two strings. The transpiler does not print it wherever a constant is named, and does not convert it to a number. */
  isJoined?: boolean;
}

function drawOperator(random: Random, name: string, value: Value, wasJoined: boolean, isInlined: boolean): Step {
  // `"" + x` and `x + ""` are printed `x` where `x` is a string.
  const literal = random.pick(value === "" ? literals.filter(literal => !isWide(valueOf(literal))) : literals);
  const other = valueOf(literal);
  const inParentheses = /^[-v]/.test(literal) ? `(${literal})` : literal;
  const areNumbers = typeof value === "number" && typeof other === "number";
  const convertsToNumber = typeof value !== "string" || (!wasJoined && !isWide(value));
  const add = (left: string, right: string): Step => {
    const isText = typeof value === "string" || typeof other === "string";
    return { text: `${left} + ${right}`, isFolded: isText ? !isWide(value) && !isWide(other) : areNumbers, isJoined: isText };
  };
  const isEqualityFolded = (op: string, left: Value, right: Value) =>
    isNullish(left) ||
    isNullish(right) ||
    (typeof left !== "string" && typeof right !== "string") ||
    (typeof left === "string" && (typeof right === "string" || (typeof right === "number" && op.length === 3)));
  return random.weighted<() => Step>([
    [3, () => ({ text: random.pick(["-", "+", "~"]) + name, isFolded: convertsToNumber })],
    [1, () => ({ text: `!${name}`, isFolded: true })],
    [4, () => add(name, literal === '""' ? '"y"' : literal)],
    [2, () => add(literal === '""' ? '"y"' : literal, name)],
    [4, () => ({ text: `${name} ${random.pick(arithmetic)} ${inParentheses}`, isFolded: areNumbers })],
    [
      3,
      () => ({
        text: `${name} ${random.pick(relations)} ${literal}`,
        isFolded: areNumbers
          ? !Number.isNaN(value) && !Number.isNaN(other) && (!isFinite(value) || !isFinite(other) || (isSafe(value) && isSafe(other)))
          : typeof value === "string" && typeof other === "string" && isWide(value) === isWide(other),
      }),
    ],
    [
      2,
      () => {
        const op = random.pick(equalities);
        return { text: `${name} ${op} ${literal}`, isFolded: isEqualityFolded(op, value, other) };
      },
    ],
    [
      1,
      () => {
        const op = random.pick(equalities);
        // A literal on the left moves to the right of a name.
        return { text: `${literal} ${op} ${name}`, isFolded: isInlined ? isEqualityFolded(op, other, value) : isEqualityFolded(op, value, other) };
      },
    ],
    [3, () => ({ text: `${name} ? ${literal} : ${random.pick(literals)}`, isFolded: true })],
    [3, () => ({ text: `${name} ${random.pick(logical)} ${literal}`, isFolded: true, isJoined: wasJoined })],
  ])();
}

function drawOtherSyntax(random: Random, name: string, value: Value): Step {
  return random.pick<Step>([
    { text: `${name}.length`, isFolded: typeof value === "string" },
    { text: `\`\${${name}}y\``, isFolded: !isWide(value) },
    { text: `(1, ${name})`, isFolded: true },
    { text: `[${name}][0]`, isFolded: true },
    { text: name, isFolded: true },
    { text: `void ${name}`, isFolded: true },
  ]);
}

function writeFunction(random: Random, index: number): string {
  const isPrefixOfConstants = random.chance(0.7);
  const keyword = isPrefixOfConstants || random.chance(0.5) ? "const" : "let";
  const statements = isPrefixOfConstants || keyword === "let" ? [] : ["pass();"];
  const declarations: string[] = [];
  const count = random.between(1, 5);
  let step: Step = { text: random.pick(literals), isFolded: true };
  let value = valueOf(step.text);
  let name = "a";
  // Whether the value is printed wherever the name stands. What is computed from a variable of which that does not hold is no literal when the transpiler decides.
  let isInlined = isPrefixOfConstants;
  for (let length = 1; ; length++) {
    declarations.push(`${keyword} ${name} = ${step.text};`);
    isInlined &&= !step.isJoined;
    if (length === count || !step.isFolded) break;
    step =
      isInlined && random.chance(0.25) && !isNullish(value)
        ? drawOtherSyntax(random, name, value)
        : drawOperator(random, name, value, !!step.isJoined, isInlined);
    name = "abcde"[length];
    value = new Function(`${declarations.join(" ")} return (${step.text});`)();
  }
  const uses = step.isFolded ? usesOfLiterals : usesOfAnyValue;
  const use = isInlined && step.isFolded && random.chance(0.1) ? "return [X, X()];" : random.pick(uses);
  const body = [...statements, ...declarations, use.replaceAll("X", name)].join(" ");
  return `show(function f${index}() { ${random.chance(0.15) ? `{ ${body} }` : body} });`;
}

export function generate(random: Random, functions = 12): string {
  return [
    "function show(run) {",
    "  try {",
    "    run();",
    '    console.log(run.name, "no error");',
    "  } catch (error) {",
    '    console.log(run.name, error.constructor.name, /:(\\d+:\\d+)\\)?$/.exec(String(error.stack).split("\\n")[1])[1]);',
    "  }",
    "}",
    "function pass(value) {",
    "  return value;",
    "}",
    "const given = globalThis.nothing;",
    ...Array.from({ length: functions }, (_, index) => writeFunction(random, index)),
    "",
  ].join("\n");
}
