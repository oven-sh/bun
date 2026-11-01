// The statements of a finally block run once, whichever way leads into them: the end of the try block, a return, a break, a continue, an exception, an exception out of the catch block.
declare const process: { argv: string[] };
const seed: number = process.argv.length > 99 ? 7 : 3;
const out: string[] = [];
let depth = 0;
let left = 0;

function work(value: number): number {
  if (value < 0) throw new RangeError("negative " + value);
  return value * 2 + depth;
}
function returns(value: number): number {
  depth++;
  try {
    return work(value);
  } finally {
    depth--;
    left++;
  }
}
function fallsOut(value: number): number {
  let result = -1;
  depth++;
  try {
    result = work(value);
  } finally {
    depth--;
  }
  return result + 1;
}
function catches(value: number): number | string {
  depth++;
  try {
    return work(value);
  } catch (error) {
    return (error as Error).message;
  } finally {
    depth--;
    left++;
  }
}
function throwsFromCatch(value: number): number {
  depth++;
  try {
    return work(value);
  } catch (error) {
    throw new TypeError("again " + (error as Error).message);
  } finally {
    depth--;
  }
}
function leavesLoops(limit: number): number {
  let sum = 0;
  for (let index = 0; index < limit; index++) {
    depth++;
    try {
      if (index === 2) continue;
      if (index === 5) break;
      sum += work(index);
    } finally {
      depth--;
      left++;
    }
  }
  return sum;
}
function nested(value: number): number {
  depth++;
  try {
    depth++;
    try {
      return work(value);
    } finally {
      depth--;
      left += 10;
    }
  } finally {
    depth--;
    left += 100;
  }
}
function overrides(value: number): number {
  try {
    return work(value);
  } finally {
    if (value === 4) return -4;
  }
}
function makes(value: number): { value: number }[] {
  const list: { value: number }[] = [];
  depth++;
  try {
    for (let index = 0; index < value; index++) list.push({ value: work(index) });
    return list;
  } finally {
    depth--;
    left++;
  }
}
function tried(name: string, run: () => unknown): void {
  let answer: string;
  try {
    answer = JSON.stringify(run());
  } catch (error) {
    answer = "threw " + (error as Error).name + ": " + (error as Error).message;
  }
  out.push(name + " " + answer + " depth " + depth + " left " + left);
}

for (let turn = 0; turn < 3; turn++) {
  for (const value of [seed + turn, -seed - turn, 4, 0]) {
    tried("returns", () => returns(value));
    tried("falls out", () => fallsOut(value));
    tried("catches", () => catches(value));
    tried("throws from catch", () => throwsFromCatch(value));
    tried("nested", () => nested(value));
    tried("overrides", () => overrides(value));
    tried("makes", () => makes(value));
  }
  tried("leaves loops", () => leavesLoops(seed + turn + 4));
}
console.log(out.join("\n"));
