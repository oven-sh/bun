// A strict compiled function tail-calls a function created from text at run time, so no compiled frame is left between that function and the code that entered compiled code when it throws or returns.
type Callee = (...values: number[]) => unknown;

const lines: string[] = [];

const throwing = new Function("value", "throw new RangeError('thrown ' + value);") as Callee;
const throwingDeeper = new Function("value", "function inner() { return null.property; } var result = inner(); return result + value;") as Callee;
const returning = new Function("value", "return 'returned ' + value;") as Callee;
let callee: Callee = returning;

function direct(value: number): unknown {
  return callee(value);
}
function conditional(value: number): unknown {
  return value > 2 ? callee(value) : callee(-value);
}
function throughAnotherTailCall(value: number): unknown {
  return direct(value + 1);
}
function withStackArguments(value: number): unknown {
  return callee(value, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12);
}
function byCall(value: number): unknown {
  return callee.call(undefined, value);
}
function afterLocals(value: number): unknown {
  const squares = [value * value, value + 0.5];
  const total = squares[0] + squares[1];
  return callee(total);
}
function notInTailPosition(value: number): unknown {
  const result = callee(value);
  return result;
}

const evaluatedCaller = new Function(
  "f",
  "value",
  "var doubled = value * 2, text = 'text' + value, list = [value, doubled], record = { sum: doubled + value }, half = value / 2, outcome;" +
    " try { outcome = f(value); } catch (error) { outcome = 'caught ' + error.name; }" +
    " return [outcome, doubled, text, list.join('+'), record.sum, half].join(' | ');",
) as (f: Callee, value: number) => string;

const evaluatedWithoutHandler = new Function(
  "f",
  "value",
  "var next = value + 1; var result = f(value); return result + ' | ' + next;",
) as (f: Callee, value: number) => string;

function compiledCaller(f: Callee, value: number): string {
  const tripled = value * 3;
  const label = "label" + value;
  const half = value / 2;
  let outcome: string;
  try {
    outcome = evaluatedWithoutHandler(f, value);
  } catch (error) {
    outcome = "caught " + (error as Error).name;
  }
  return [outcome, tripled, label, half].join(" | ");
}

const callees: Array<[string, Callee]> = [
  ["throwing", throwing],
  ["throwing deeper", throwingDeeper],
  ["returning", returning],
];
const forms: Array<[string, Callee]> = [
  ["direct", direct],
  ["conditional", conditional],
  ["through another tail call", throughAnotherTailCall],
  ["with stack arguments", withStackArguments],
  ["by call", byCall],
  ["after locals", afterLocals],
  ["not in tail position", notInTailPosition],
];

for (const [calleeName, nextCallee] of callees) {
  callee = nextCallee;
  for (const [formName, form] of forms) {
    lines.push(calleeName + ", " + formName + ", evaluated caller: " + evaluatedCaller(form, 3));
    lines.push(calleeName + ", " + formName + ", compiled caller: " + compiledCaller(form, 5));
  }
}

let caught = 0;
let returned = 0;
for (let round = 0; round < 3000; round++) {
  callee = round % 3 ? throwing : returning;
  if (evaluatedCaller(forms[round % forms.length][1], round).startsWith("caught RangeError | " + round * 2)) caught++;
  else returned++;
}
lines.push("3000 rounds: caught " + caught + ", returned " + returned);

console.log(lines.join("\n"));
export {};
