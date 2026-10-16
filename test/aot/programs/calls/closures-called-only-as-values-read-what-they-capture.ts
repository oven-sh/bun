// Functions that nothing calls by name: every call comes through a value, so the function itself fetches what it captures.
interface Point { x: number; y: number }
type Unary = (n: number) => number;

const sink: unknown[] = [];
function keep<T>(value: T): T { sink.push(value); return sink[sink.length - 1] as T; }

function oneNumber(a: number): Unary { return n => n + a; }
function twoNumbers(a: number, b: number): Unary { return n => n * a + b; }
function wholeAndFraction(a: number, b: number): Unary { const whole = a | 0; return n => n * whole + b; }
function flagAndText(flag: boolean, text: string): (n: number) => string { return n => (flag ? text + n : text); }
function objectAndFunction(p: Point, f: Unary): (n: number, m: number) => number { return (n, m) => f(n) * p.x + m * p.y; }
function six(a: number, b: string, c: boolean, d: Point, e: Unary, g: number[]): (n: number) => string {
    return n => [a + n, b, c, d.x + d.y, e(n), g.length].join(" ");
}
function manyParameters(k: number): (a: number, b: string, c: number, d: Point, e: number, f: string, g: number) => string {
    return (a, b, c, d, e, f, g) => [k, a, b, c, d.x, e, f, g].join(",");
}
function fourReferences(k: string): (a: string, b: string, c: string, d: string) => string { return (a, b, c, d) => k + a + b + c + d; }
function fiveReferences(k: string): (a: string, b: string, c: string, d: string, e: string) => string { return (a, b, c, d, e) => k + a + b + c + d + e; }
function withThis(k: number) { return function (this: Point, n: number): number { return this.x * k + n; }; }
function changing(): { bump: () => number; read: () => number } { let count = 0; return { bump: () => ++count, read: () => count }; }
function recursive(step: number): Unary { const down: Unary = n => (n <= 0 ? 0 : step + keep(down)(n - 1)); return down; }
function nested(a: number): (b: number) => (c: number) => number { return b => c => a * 100 + b * 10 + c; }
function missing(k: string): (a?: string, b?: number) => string { return (a, b) => k + String(a) + String(b); }
function rest(k: number): (...all: number[]) => number { return (...all) => all.reduce((s, n) => s + n, k); }
function throws(k: string): () => never { return () => { throw new Error("thrown with " + k); }; }
function constructs(k: number) { return function Made(this: { value: number }, n: number) { this.value = n + k; } as unknown as new (n: number) => { value: number }; }
async function later(k: number): Promise<() => Promise<number>> { return async () => (await Promise.resolve(k)) + 1; }
function* counting(k: number): Generator<() => number> { for (let i = 0; i < 3; i++) yield () => k + i; }

const point: Point = { x: 3, y: 4 };
const lines: string[] = [];
function say(...parts: unknown[]) { lines.push(parts.map(String).join(" ")); }

for (let round = 0; round < 3; round++) {
    say(keep(oneNumber(round + 0.5))(2), keep(twoNumbers(round, 0.25))(3), keep(wholeAndFraction(round + 2.75, 0.5))(2));
    say(keep(flagAndText(round % 2 === 0, "t"))(round), keep(objectAndFunction(point, oneNumber(round)))(1, 2));
    say(keep(six(round, "b", round === 1, point, twoNumbers(2, round), [1, 2, round]))(5));
    say(keep(manyParameters(round))(1.5, "two", 3, point, 5.5, "six", 7));
    say(keep(fourReferences("k" + round))("a", "b", "c", "d"), keep(fiveReferences("k" + round))("a", "b", "c", "d", "e"));
    say(keep(withThis(round)).call(point, 1), keep(withThis(round)).apply({ x: 10, y: 0 }, [2]), keep(withThis(round)).bind(point)(3));
    const counter = keep(changing());
    say(counter.bump(), counter.bump(), counter.read());
    say(keep(recursive(round + 1))(4), keep(keep(keep(nested(round))(2))(3)));
    say(keep(missing("m"))(), keep(missing("m"))("a"), keep(missing("m"))("a", round), (keep(missing("m")) as (...all: unknown[]) => string)("a", 1, "extra"));
    say(keep(rest(round))(), keep(rest(round))(1, 2, 3, 4, 5, 6, 7));
    try { keep(throws("k" + round))(); } catch (error) { say((error as Error).message); }
    say(new (keep(constructs(round)))(5).value);
}

const untyped = keep(twoNumbers(2, 1)) as unknown as (...all: unknown[]) => unknown;
say("through unknown", String(untyped(4)), String(untyped(0.5, "extra")));

const decorated = keep(oneNumber(10)) as Unary & { note?: string };
decorated.note = "has a property";
say(decorated(1), decorated.note, decorated.name, decorated.length, typeof decorated, Object.keys(decorated).join());
say([1, 2, 3].map(keep(twoNumbers(3, 1))).join(), [3, 1, 2].sort(keep(((k: number) => (a: number, b: number) => (a - b) * k)(-1))).join());
say(["a", "b"].map(keep(((k: string) => (s: string, i: number) => k + s + i)("#"))).join());
say(JSON.stringify({ a: 1, b: 2 }, keep(((k: number) => (key: string, value: unknown) => (typeof value === "number" ? value + k : value))(5))));
say("abc".replace(/b/, keep(((k: string) => (m: string) => k + m + k)("-"))));
say(new Map([[1, 2]]).forEach(keep(((k: number) => (v: number, key: number) => { say("map", k, key, v); })(7))));
for (const f of counting(10)) say(keep(f)());
say(keep(oneNumber(1)) === keep(oneNumber(1)), sink.length > 0);

later(41).then(f => keep(f)()).then(n => { say("later", n); console.log(lines.join("\n")); });
