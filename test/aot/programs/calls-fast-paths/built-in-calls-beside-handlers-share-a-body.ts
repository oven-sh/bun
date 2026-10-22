// A call of a built-in method in a function that has a `try` goes through the body it shares with equal calls elsewhere, wherever it stands: inside the `try`, in the handler, in `finally`, or outside of them. In a loop it stays in line, and so does the call that makes what a `for..of` goes over, which is compiled together with its loop.
// IR-UNTIL OutlineColdOperations
// IR= 0 insideTry CallBuiltin v[0-9]+ \(\) overload=StringPrototypeTrim/
// IR= 0 inHandler CallBuiltin v[0-9]+ \(\) overload=StringPrototypeTrim/
// IR= 0 inFinally CallBuiltin v[0-9]+ \(\) overload=StringPrototypeTrim/
// IR= 0 besideTry CallBuiltin v[0-9]+ \(\) overload=StringPrototypeTrim/
// IR= 1 inLoop CallBuiltin v[0-9]+ \(\) overload=StringPrototypeTrim/
// IR= 0 keysOrName CallBuiltin - \(v[0-9]+\) overload=ObjectKeys/
// IR= 0 keysOrNothing CallBuiltin - \(v[0-9]+\) overload=ObjectKeys/
// IR= 0 countKeys CallBuiltin - \(v[0-9]+\) overload=ObjectKeys/
// IR= 0 countKeysOrNone CallBuiltin - \(v[0-9]+\) overload=ObjectKeys/
// IR= 1 overKeys CallBuiltin - \(v[0-9]+\) overload=ObjectKeys/
// IR= 1 isPlainNumber CallBuiltin - \(v[0-9]+\) overload=NumberIsNaN/
// IR= 1 isPlainNumber CallBuiltin - \(v[0-9]+\) overload=NumberIsFinite/
// IR= 1 isWholeNumber CallBuiltin - \(v[0-9]+\) overload=NumberIsNaN/
// IR= 1 isWholeNumber CallBuiltin - \(v[0-9]+\) overload=NumberIsInteger/
function isPlainNumber(value: any): boolean {
  try {
    measure(String(value));
  } catch {}
  return !Number.isNaN(value) && Number.isFinite(value);
}
function isWholeNumber(value: any): boolean {
  try {
    measure(String(value));
  } catch {}
  return !Number.isNaN(value) && Number.isInteger(value);
}
function measure(text: string): number {
  if (text.length > 6) throw new RangeError("too long: " + text);
  return text.length;
}

export function insideTry(text: string): string {
  try {
    const trimmed = text.trim();
    return trimmed + measure(trimmed);
  } catch (error) {
    return "caught " + (error as Error).message;
  }
}

export function inHandler(text: string): string {
  try {
    return "" + measure(text);
  } catch {
    return text.trim();
  }
}

export function inFinally(text: string, log: string[]): number {
  try {
    return measure(text);
  } finally {
    log.push(text.trim());
  }
}

export function besideTry(text: string): string {
  const trimmed = text.trim();
  try {
    return trimmed + measure(trimmed);
  } catch {
    return trimmed;
  }
}

export async function afterAwait(text: Promise<string>): Promise<string> {
  try {
    const trimmed = (await text).trim();
    return trimmed + measure(trimmed);
  } catch (error) {
    return "caught " + (error as Error).message;
  }
}

export function inLoop(texts: string[]): string {
  let all = "";
  try {
    for (const text of texts) all += text.trim();
  } catch {
    all = "never";
  }
  return all;
}

export function keysOrName(value: object): string {
  try {
    return Object.keys(value).join();
  } catch (error) {
    return (error as Error).name;
  }
}

export function keysOrNothing(value: object): string {
  try {
    return Object.keys(value).join();
  } catch {
    return "nothing";
  }
}

export function countKeys(value: Record<string, number>): number {
  try {
    return Object.keys(value).length + measure("ab");
  } catch {
    return -1;
  }
}

export function countKeysOrNone(value: Record<string, number>): number {
  try {
    return Object.keys(value).length + measure("abcdefgh");
  } catch {
    return 0;
  }
}

export function overKeys(value: Record<string, number>): number {
  let sum = 0;
  for (const key of Object.keys(value)) sum += value[key];
  return sum;
}

let entered = 0;
let left = 0;
export function descend(text: string): number {
  entered++;
  try {
    const trimmed = text.trim();
    return descend(trimmed + " ") + 1;
  } finally {
    left++;
  }
}

const f: any = { isPlainNumber, isWholeNumber, insideTry, inHandler, inFinally, besideTry, afterAwait, inLoop, keysOrName, keysOrNothing, countKeys, countKeysOrNone, overKeys, descend };
const log: string[] = [];
console.log(f.insideTry("  ab "), "|", f.insideTry("  abcdefgh "));
console.log(f.inHandler("abc"), "|", f.inHandler("  abcdefgh "));
console.log(f.inFinally(" ab ", log), "|", log.join());
try {
  f.inFinally("  abcdefgh ", log);
} catch (error) {
  console.log((error as Error).message, "|", log.join());
}
console.log(f.besideTry("  ab "), "|", f.besideTry("  abcdefgh "));
for (const value of [1, 1.5, NaN, Infinity, "1", null, undefined, {}, 12345678]) console.log(f.isPlainNumber(value), f.isWholeNumber(value));
console.log(f.inLoop([" a", "b ", " c "]));
const throwing = new Proxy({}, { ownKeys() { throw new SyntaxError("no keys"); } });
console.log(f.keysOrName({ a: 1, b: 2 }), "|", f.keysOrName(throwing), "|", f.keysOrName(null), "|", f.keysOrNothing({ c: 3 }), "|", f.keysOrNothing(throwing), "|", f.keysOrNothing(undefined));
console.log(f.countKeys({ a: 1, b: 2 }), f.countKeysOrNone({ a: 1 }), f.overKeys({ a: 1, b: 2, c: 4 }));
console.log(await f.afterAwait(Promise.resolve("  ab ")), "|", await f.afterAwait(Promise.resolve("  abcdefgh ")), "|", await f.afterAwait(Promise.reject(new Error("rejected"))));
try {
  f.descend(" x ");
} catch (error) {
  console.log((error as Error).name, entered > 100, entered === left);
}
