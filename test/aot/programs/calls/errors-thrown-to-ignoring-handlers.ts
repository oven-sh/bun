// `throw new Error("text")` to a handler that never looks at what it catches, and to handlers that do: the program behaves as in plain Bun.
const log: string[] = [];
function check(n: number): number {
  if (n % 2) throw new Error("too small");
  return n;
}
function checkRange(n: number): number {
  if (n % 3 === 0) throw new RangeError("out of range");
  if (n % 3 === 1) throw new TypeError("of the wrong kind");
  return n;
}
function deeper(depth: number, n: number): number {
  return depth ? deeper(depth - 1, n) + 1 : check(n) + checkRange(n);
}
function ignores(n: number): number {
  try {
    return check(n);
  } catch {
    return -1;
  }
}
function ignoresBinding(n: number): number {
  try {
    return deeper(3, n);
  } catch (error) {
    return -2;
  }
}
function looks(n: number): string {
  try {
    return String(deeper(2, n));
  } catch (error) {
    const e = error as Error;
    return [e instanceof Error, e.name, e.message, typeof e.stack, e.stack!.includes("check"), Object.keys(e).length].join();
  }
}
function throwsHere(n: number): number {
  try {
    if (n % 2) throw new Error("thrown and ignored in one function");
    return n;
  } catch {
    return -3;
  }
}
function throwsHereAndLooks(n: number): string {
  try {
    if (n % 2) throw new SyntaxError("thrown and read in one function");
    return "none";
  } catch (error) {
    return (error as Error).name + ": " + (error as Error).message;
  }
}
function behindFinally(n: number): number {
  try {
    try {
      return check(n);
    } finally {
      log.push("finally " + n);
    }
  } catch {
    return -4;
  }
}
function innerLooksOuterIgnores(n: number): string {
  let seen = "nothing";
  try {
    try {
      check(n);
    } catch (error) {
      seen = (error as Error).message;
      throw error;
    }
  } catch {
    seen += " and ignored";
  }
  return seen;
}
function innerIgnoresOuterLooks(n: number): string {
  try {
    try {
      check(n);
    } catch {
      log.push("ignored " + n);
    }
    return String(checkRange(n));
  } catch (error) {
    return (error as Error).name;
  }
}
async function asyncIgnores(n: number): Promise<number> {
  await null;
  try {
    return check(n);
  } catch {
    return -5;
  }
}
async function asyncRejects(n: number): Promise<number> {
  await null;
  return check(n);
}
function throughCallback(list: number[]): number {
  try {
    list.forEach(n => check(n));
    return list.length;
  } catch {
    return -6;
  }
}
function* generates(n: number): Generator<number> {
  try {
    yield check(n);
  } catch {
    yield -7;
  }
}
async function main(): Promise<void> {
  for (let n = 0; n < 6; n++) {
    log.length = 0;
    console.log([ignores(n), ignoresBinding(n), looks(n), throwsHere(n), throwsHereAndLooks(n), behindFinally(n), innerLooksOuterIgnores(n), innerIgnoresOuterLooks(n), await asyncIgnores(n), await asyncRejects(n).catch(error => (error as Error).message), throughCallback([2, n]), [...generates(n)].join()].join(" | "), log.join());
  }
  let sum = 0;
  for (let n = 0; n < 30000; n++) sum += ignores(n) + ignoresBinding(n) + throwsHere(n) + looks(n).length;
  console.log(sum);
}
main();
