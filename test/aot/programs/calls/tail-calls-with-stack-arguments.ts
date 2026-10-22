// Indirect tail calls between functions with twelve parameters, more than fit in argument registers, whose callees no analysis can resolve: a million hops run in constant stack space and every argument arrives.
const hops = 1_000_000;
const opaque = new Function("value", "return value") as <T>(value: T) => T;
function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + String(run()));
  } catch (error: any) {
    console.log(label + ": " + error.constructor.name + (error instanceof RangeError ? " " + error.message : ""));
  }
}
let ending = "join";
function finish(name: string, values: unknown[]): string {
  const text = name + " " + values.map(String).join();
  if (ending === "throw") throw new RangeError(text);
  if (ending === "frames") {
    const names = String(new Error().stack).split("\n").map(line => /\b(finish|attempt|ping|pong)\b/.exec(line)?.[1] ?? "?");
    return names.slice(names.indexOf("finish"), names.indexOf("attempt") + 1).join();
  }
  return text;
}

const table: any[] = opaque([]);
function ping(n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
  if (n === 0) return finish("ping", [a, b, c, d, e, f, g, h, i, j, k]);
  const next = table[n & 1];
  return next(n - 1, k, a, b, c, d, e, f, g, h, i, j);
}
function pong(n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
  return n === 0 ? finish("pong", [a, b, c, d, e, f, g, h, i, j, k]) : table[n % 3 === 0 ? 0 : 1](n - 1, b, a, d, c, f, e, h, g, j, i, k);
}
function few(n: any): any {
  return n === 0 ? "few" : table[3](n - 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
}
function many(n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
  return n === 0 ? finish("many", [a, b, c, d, e, f, g, h, i, j, k]) : table[2](n - 1);
}
const createHop = (tag: string, next: number) =>
  function (n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
    return n === 0 ? finish(tag, [a, b, c, d, e, f, g, h, i, j, k]) : table[next](n - 1, k, a, b, c, d, e, f, g, h, i, j);
  };
function spreadRest(n: any, ...rest: any[]): any {
  return n === 0 ? finish("spreadRest", rest) : table[7](n - 1, ...rest);
}
function passTwelve(n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
  return n === 0 ? finish("passTwelve", [a, b, c, d, e, f, g, h, i, j, k]) : table[6](n - 1, b, c, d, e, f, g, h, i, j, k, a);
}
function callBound(n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
  return n === 0 ? finish("callBound", [a, b, c, d, e, f, g, h, i, j, k]) : table[8](n - 1, k, a, b, c, d, e, f, g, h, i, j);
}
function callUndefined(n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
  return table[n === 0 ? 99 : 9](n - 1, k, a, b, c, d, e, f, g, h, i, j);
}
function skipOdd(n: any): any {
  return n & 1 ? skipOdd(n - 1) : table[10](n, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
}
function callSkipOdd(n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
  return n === 0 ? finish("callSkipOdd", [a, b, c, d, e, f, g, h, i, j, k]) : skipOdd(n - 1);
}
table.push(ping, pong, few, many, createHop("first closure", 5), createHop("second closure", 4), spreadRest, passTwelve, callBound.bind(undefined), callUndefined, callSkipOdd);
const holder: any = opaque({
  tag: "holder",
  step(n: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any): any {
    return n === 0 ? finish(this.tag, [a, b, c, d, e, f, g, h, i, j, k]) : this.step(n - 1, k, a, b, c, d, e, f, g, h, i, j);
  },
});

type Numeric = (n: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => number;
const numeric: Numeric[] = opaque([]);
function rise(n: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number): number {
  return n === 0 ? a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + 9 * i + 10 * j + 11 * k : numeric[n & 1](n - 1, k, a, b, c, d, e, f, g, h, i, j);
}
function fall(n: number, a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number): number {
  return n === 0 ? -(a + 2 * b + 3 * c + 4 * d + 5 * e + 6 * f + 7 * g + 8 * h + 9 * i + 10 * j + 11 * k) : numeric[(n >> 1) & 1](n - 1, b, c, d, e, f, g, h, i, j, k, a);
}
numeric.push(rise, fall);

function left(n: number, a: string, b: string, c: string, d: string, e: string, f: string, g: string, h: string, i: string, j: string, k: string): string {
  return n === 0 ? finish("left", [a, b, c, d, e, f, g, h, i, j, k]) : right(n - 1, k, j, i, h, g, f, e, d, c, b, a);
}
function right(n: number, a: string, b: string, c: string, d: string, e: string, f: string, g: string, h: string, i: string, j: string, k: string): string {
  return n === 0 ? finish("right", [a, b, c, d, e, f, g, h, i, j, k]) : left(n - 1, k, a, b, c, d, e, f, g, h, i, j);
}
function callWithLiveValues(n: number): string {
  if (n >= 0) return left(n, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k");
  const [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15]: number[] = opaque([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  return callWithLiveValues(-n) + " " + [p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15].join();
}

attempt("any arguments, indirect calls", () => table[0](hops, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11));
attempt("number arguments, indirect calls", () => numeric[0](hops, 0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5));
attempt("one parameter, then twelve", () => table[2](hops));
attempt("twelve parameters, then one", () => table[3](hops, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11));
attempt("twelve parameters, then a direct call with one", () => table[10](hops, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11));
attempt("closures", () => table[4](hops, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11));
attempt("method calls", () => holder.step(hops, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11));
attempt("a rest parameter and a spread", () => table[6](hops, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11));
attempt("direct calls", () => left(hops, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"));
attempt("sixteen values live across the call", () => callWithLiveValues(-hops));
attempt("not callable at the end", () => table[9](hops, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11));
attempt("called by native code", () => JSON.parse(String(hops), (_key, value) => table[0](value, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11)));
attempt("called by interpreted code", () => new Function("hop", "n", "return '' + hop(n, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11)")(table[0], hops));
attempt("a bound function, a thousand hops", () => table[8](1000, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11));
ending = "throw";
attempt("throw at the end, indirect calls", () => table[0](hops, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11));
attempt("throw at the end, direct calls", () => left(hops, "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"));
ending = "frames";
attempt("stack frames at the end", () => table[0](hops, 1, "two", 3.5, true, null, undefined, "seven", 8, 9.25, "ten", 11));
export {};
