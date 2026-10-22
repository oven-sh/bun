// A number, a boolean, a string, a literal and a reference returned through `finally`, on every path there is: the return, the end of the block, a throw, a break, a return in the `finally` block that takes the place of the first.
let log = "";
function note(text: string): void {
  log += text;
}
function number(i: number): number {
  try {
    if (i === 1) throw new Error("one");
    if (i === 2) return i * 1.5;
    note("n");
  } finally {
    note("f");
  }
  return -1;
}
function flag(i: number): boolean {
  try {
    if (i === 1) throw new Error("one");
    return i > 1;
  } finally {
    note("f");
  }
}
function text(i: number): string {
  for (;;) {
    try {
      if (i === 1) throw new Error("one");
      if (i === 2) break;
      return "returned";
    } finally {
      note("f");
    }
  }
  return "broke";
}
function literal(i: number): 3 | 4 {
  try {
    if (i === 1) throw new Error("one");
    return i === 2 ? 3 : 4;
  } finally {
    note("f");
  }
}
function reference(i: number): { i: number } {
  try {
    if (i === 1) throw new Error("one");
    return { i };
  } finally {
    note("f");
  }
}
function replaced(i: number): number {
  try {
    if (i === 1) throw new Error("one");
    return 1;
  } finally {
    if (i !== 2) return 2;
  }
}
async function awaited(i: number): Promise<number> {
  try {
    if (i === 1) throw new Error("one");
    return await Promise.resolve(i * 2);
  } finally {
    note("f");
  }
}
function attempt<T>(body: (i: number) => T, i: number): T | string {
  try {
    return body(i);
  } catch (error) {
    return "caught " + (error as Error).message;
  }
}
for (let i = 0; i < 4; i++) {
  console.log(i, attempt(number, i), attempt(flag, i), attempt(text, i), attempt(literal, i), JSON.stringify(attempt(reference, i)), attempt(replaced, i));
}
let sum = 0;
for (let i = 2; i < 1000; i++) sum += number(i) + (flag(i) ? 1 : 0) + literal(i) + text(i).length + reference(i).i + replaced(i);
console.log(sum, log.length);
for (let i = 0; i < 3; i++) console.log(await awaited(i).catch(error => "rejected " + error.message));
