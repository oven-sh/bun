// A call of a global built-in in tail position hands no frame on to the program's code: what stands behind it stays in the function, whoever receives the result and however hot the functions are.
function attempt(what: () => unknown): string { try { const got = what(); return typeof got + " " + String(got); } catch (e) { return (e as Error).constructor.name; } }
const g: any = globalThis;
interface Config { port: number }
function count(text: string): number { return JSON.parse(text) as number; }
function config(text: string): Config { return JSON.parse(text) as Config; }
function largest(a: number, b: number): number { return Math.max(a, b); }
function text(x: unknown): string { return String(x); }
function whole(x: string): number { return parseInt(x, 10); }
class Point {
  constructor(public x: number, public y: number) {}
  copy(): Point { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); }
  keys(): string[] { return Object.keys(this); }
}
g.keep = [count, config, largest, text, whole];
const rows: [string, () => unknown][] = [
  ["JSON.parse as number", () => count('"4"')],
  ["JSON.parse as number, used", () => count('"4"') + 1],
  ["JSON.parse as number, as a value", () => g.keep[0]('"4"')],
  ["JSON.parse as an object type", () => config('{"port":80}').port + 1],
  ["JSON.parse as an object type, as a value", () => g.keep[1]('{"port":80}').port],
  ["JSON.parse that throws", () => count("{")],
  ["Math.max", () => largest(1, 2)],
  ["Math.max, as a value", () => g.keep[2](1, 2)],
  ["String", () => text(5) + "!"],
  ["parseInt", () => whole("12px") + 1],
  ["Object.assign", () => new Point(1, 2).copy().y],
  ["Object.assign, an instance", () => new Point(1, 2).copy() instanceof Point],
  ["Object.keys", () => new Point(1, 2).keys().join()],
  ["in a mapper", () => ['"4"', "5"].map(t => JSON.parse(t) as number).map(x => typeof x).join()],
];
for (let round = 0; round < 2; round++) for (const [name, what] of rows) console.log(round, name + ": " + attempt(what));
