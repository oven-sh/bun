// Loops inside try blocks: what a catch clause and a finally block see of the variables of the loop, wherever the loop throws, returns, breaks or comes to its end.
const lines: string[] = [];
const floats = new Float64Array(64);
for (let i = 0; i < floats.length; i++) floats[i] = i;
const bytes = new Uint8Array(64);
for (let i = 0; i < bytes.length; i++) bytes[i] = i * 3;
const list: number[] = [];
for (let i = 0; i < 64; i++) list.push(i * 2);
let closed = 0;

function sumInTry(view: Float64Array): number {
  let sum = 0;
  try {
    for (let k = 0; k < view.length; k++) sum += view[k];
  } catch {
    sum = -1;
  }
  return sum;
}
function sumWithFinally(view: Uint8Array): number {
  let sum = 0;
  try {
    for (let k = 0; k < view.length; k++) sum = (sum + view[k]) | 0;
  } finally {
    closed += sum;
  }
  return sum;
}
function throwsAt(values: number[], stop: number): string {
  let sum = 0;
  let k = 0;
  try {
    for (; k < values.length; k++) {
      if (values[k] === stop) throw new RangeError("at " + k);
      sum += values[k];
    }
  } catch (error) {
    return "caught " + (error as Error).message + " with " + sum + " at " + k;
  } finally {
    closed++;
  }
  return "ended with " + sum + " at " + k;
}
function readsOfNothing(values: (number[] | null)[]): string {
  let sum = 0;
  let k = 0;
  try {
    for (; k < values.length; k++) sum += values[k]!.length;
  } catch (error) {
    return (error as Error).constructor.name + " with " + sum + " at " + k;
  }
  return "ended with " + sum + " at " + k;
}
function returnsFromTheLoop(view: Float64Array, wanted: number): number {
  let seen = 0;
  try {
    for (let k = 0; k < view.length; k++) {
      seen++;
      if (view[k] === wanted) return k;
    }
    return -1;
  } finally {
    closed += seen;
  }
}
function digits(text: string): string {
  let value = 0;
  let k = 0;
  try {
    for (; k < text.length; k++) {
      const code = text.charCodeAt(k);
      if (code < 48 || code > 57) throw new SyntaxError("no digit");
      value = (value * 10 + code - 48) % 1000003;
    }
  } catch (error) {
    return (error as Error).message + " at " + k + " behind " + value;
  }
  return "" + value;
}
function makesThenWalks(length: number): number {
  let sum = 0;
  try {
    const view = new Float64Array(length);
    for (let k = 0; k < view.length; k++) view[k] = k;
    for (let k = 0; k < view.length; k++) sum += view[k];
  } catch (error) {
    return (error as Error).constructor === RangeError ? -1 : -2;
  }
  return sum;
}
function innerOfTwo(values: number[], stop: number): string {
  let trace = "";
  try {
    trace += "a";
    try {
      for (let k = 0; k < values.length; k++) if (values[k] === stop) throw k;
      trace += "b";
    } catch (thrown) {
      trace += "c" + thrown;
      if (thrown === 3) throw "again";
    } finally {
      trace += "d";
    }
    trace += "e";
  } catch (thrown) {
    trace += "f" + thrown;
  }
  return trace;
}
function tryInTheLoop(values: (number[] | null)[]): string {
  let sum = 0;
  let failed = 0;
  for (let k = 0; k < values.length; k++) {
    try {
      sum += values[k]!.length;
    } catch {
      failed += k;
    }
  }
  return sum + " " + failed;
}
function viewShrinksOnTheWay(): string {
  const buffer = new ArrayBuffer(64, { maxByteLength: 128 });
  const view = new Uint8Array(buffer);
  view.fill(1);
  let sum = 0;
  let k = 0;
  try {
    for (; k < view.length; k++) {
      sum += view[k];
      if (k === 10) buffer.resize(16);
    }
  } catch {
    return "threw";
  }
  return sum + " " + k;
}

for (let round = 0; round < 3; round++) {
  lines.push("sum " + sumInTry(floats) + " " + sumInTry(new Float64Array(0)) + " " + sumWithFinally(bytes) + " " + closed);
  lines.push(throwsAt(list, 40) + " | " + throwsAt(list, 0) + " | " + throwsAt(list, 126) + " | " + throwsAt(list, 1) + " | " + closed);
  lines.push(readsOfNothing([[1], [1, 2], null, [3]]) + " | " + readsOfNothing([[1], [1, 2]]) + " | " + readsOfNothing([null]));
  lines.push("returns " + returnsFromTheLoop(floats, 5) + " " + returnsFromTheLoop(floats, 63) + " " + returnsFromTheLoop(floats, 0.5) + " " + closed);
  lines.push(digits("73912") + " | " + digits("73x12") + " | " + digits("") + " | " + digits("x") + " | " + digits("12".repeat(40) + "-"));
  lines.push("makes " + makesThenWalks(10) + " " + makesThenWalks(0) + " " + makesThenWalks(-1) + " " + makesThenWalks(1.5));
  lines.push(innerOfTwo(list, 4) + " " + innerOfTwo(list, 6) + " " + innerOfTwo(list, 5));
  lines.push(tryInTheLoop([[1], null, [1, 2, 3], null]) + " | " + viewShrinksOnTheWay());
}
console.log(lines.join("\n"));
