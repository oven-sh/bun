// Operations of the engine that throw inside `try`, on and off the usual path, while many values are alive in registers: every value is what it was when the handler runs.
const anything: any = { nothing: null, json: JSON, text: "text", list: [1, 2, 3], big: 10n };
const log: string[] = [];
function name(error: unknown): string {
  return error instanceof Error ? error.name : String(error);
}
function manyIntegers(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, target: any): string {
  let i = a + b, j = c + d, k = e + f, l = g + h, m = a * c, n = b * d, o = e * g, p = f * h;
  try {
    i += target.length;
    j += target.deeper.length;
    k += 1000;
  } catch (error) {
    return [name(error), a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p].join();
  }
  return ["none", a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p].join();
}
function manyDoubles(a: number, b: number, c: number, d: number, e: number, f: number, target: any): string {
  let i = a / 3, j = b / 7, k = c * 1.5, l = d - 0.25, m = e + f / 9, n = a * b * 0.1;
  try {
    i += target.value.inner;
    j += 0.5;
  } catch (error) {
    return [name(error), a, b, c, d, e, f, i, j, k, l, m, n].map(String).join();
  }
  return ["none", a, b, c, d, e, f, i, j, k, l, m, n].map(String).join();
}
function stringsAndObjects(text: string, list: number[], record: { x: number; y: string }, target: any): string {
  const upper = text.toUpperCase(), first = list[0]!, sum = record.x + first, joined = record.y + text;
  try {
    return "none " + target.method(upper, sum);
  } catch (error) {
    return [name(error), text, upper, list.length, first, sum, joined, record.x, record.y].join();
  }
}
function inLoop(limit: number, target: any): string {
  let sum = 0, product = 1, caught = 0;
  for (let i = 0; i < limit; i++) {
    sum += i;
    product = (product * 3) % 1000003;
    try {
      sum += i % 3 ? 1 : target.at.all;
    } catch (error) {
      caught++;
    }
  }
  return [sum, product, caught].join();
}
function nested(target: any, a: number, b: number): string {
  let inner = a * 2, outer = b * 3;
  try {
    try {
      inner += target.one.two;
    } catch (error) {
      log.push("inner " + name(error) + " " + inner + " " + outer);
      outer += target.three.four;
    } finally {
      log.push("finally " + inner + " " + outer);
    }
  } catch (error) {
    return ["outer", name(error), a, b, inner, outer].join();
  }
  return ["none", a, b, inner, outer].join();
}
function mixesBigInt(a: number, target: any): string {
  let kept = a * 5;
  try {
    kept += target.big + a;
  } catch (error) {
    return name(error) + " " + kept + " " + a;
  }
  return "none " + kept;
}
function callsNothing(a: number, b: number, target: any): string {
  const kept = a - b;
  try {
    target.nothing();
  } catch (error) {
    return name(error) + " " + kept + " " + a + " " + b;
  }
  return "none";
}
function constructsNothing(a: number, target: any): string {
  const kept = a + 0.5;
  try {
    new target.text();
  } catch (error) {
    return name(error) + " " + kept;
  }
  return "none";
}
function usesIn(a: number, target: any): string {
  const kept = a * a;
  try {
    return String("x" in target.text) + kept;
  } catch (error) {
    return name(error) + " " + kept;
  }
}
function spreadsNothing(a: number, target: any): string {
  const kept = a ^ 21;
  try {
    return String([...target.nothing].length + kept);
  } catch (error) {
    return name(error) + " " + kept;
  }
}
function getterThrows(a: number, b: number): string {
  const holder: any = { get bad(): number { throw new RangeError("from a getter"); } };
  let kept = a + b;
  try {
    kept += holder.bad;
  } catch (error) {
    return name(error) + " " + kept + " " + a + " " + b;
  }
  return "none";
}
async function inAsync(a: number, target: any): Promise<string> {
  const before = a * 7;
  await null;
  const after = a * 11;
  try {
    return "none " + target.nothing.length;
  } catch (error) {
    return [name(error), a, before, after].join();
  }
}
function* inGenerator(a: number, target: any): Generator<string> {
  const kept = a * 13;
  yield "started " + kept;
  try {
    yield "none " + target.nothing.length;
  } catch (error) {
    yield [name(error), a, kept].join();
  }
}
async function main(): Promise<void> {
  for (const target of [anything.list, anything.nothing, undefined, { length: 5 }, { length: 5, deeper: "four" }]) console.log(manyIntegers(1, 2, 3, 4, 5, 6, 7, 8, target));
  for (const target of [{ value: { inner: 0.125 } }, { value: null }, null, {}]) console.log(manyDoubles(1.5, 2.5, 3.5, 4.5, 5.5, 6.5, target));
  for (const target of [{ method: (a: string, b: number) => a + b }, {}, null, { method: 1 }]) console.log(stringsAndObjects("text", [4, 5], { x: 6, y: "why" }, target));
  console.log(inLoop(1000, anything), inLoop(1000, { at: { all: 2 } }));
  for (const target of [{ one: { two: 1 } }, {}, { three: { four: 2 } }, null]) {
    log.length = 0;
    console.log(nested(target, 3, 4), log.join(" ; "));
  }
  console.log(mixesBigInt(3, anything), mixesBigInt(3, { big: 1 }));
  console.log(callsNothing(9, 4, anything), constructsNothing(2, anything), usesIn(5, anything), spreadsNothing(6, anything), getterThrows(7, 8));
  console.log(await inAsync(3, anything), await inAsync(3, { nothing: "four" }));
  console.log([...inGenerator(2, anything)].join(" ; "), [...inGenerator(2, { nothing: [1] })].join(" ; "));
  let total = 0;
  for (let i = 0; i < 20000; i++) total += manyIntegers(i, 2, 3, 4, 5, 6, 7, 8, i % 2 ? null : anything.list).length + manyDoubles(i, 2.5, 3.5, 4.5, 5.5, 6.5, i % 3 ? null : { value: { inner: 1 } }).length;
  console.log(total);
}
main();
