import { nextTurns } from "../host.ts";
// Every property of a table of settings is a getter, all the getters are closures of one function, and small predicates read them.
// The table has been handed to code that nobody has seen, and elsewhere the program gives a function it does not know a displayName.
interface Parser<T> {
  parse(raw: string | undefined): T;
}
function makeGetter<T>(
  key: string,
  parser: Parser<T>,
  source: Record<string, string | undefined>,
  unread: unknown,
): () => T {
  let lastRaw: unknown = unread;
  let lastParsed: T;
  return () => {
    const raw = source[key];
    if (raw !== lastRaw) {
      lastParsed = parser.parse(raw);
      lastRaw = raw;
    }
    return lastParsed;
  };
}
const flag: Parser<boolean> = { parse: raw => raw === "1" || raw === "true" };
const count: Parser<number> = { parse: raw => (raw === undefined ? 0 : Number(raw) | 0) };
const text: Parser<string> = { parse: raw => raw ?? "" };
const shape = { ALPHA: flag, BETA: flag, GAMMA: count, DELTA: text, EPSILON: flag, ZETA: count, ETA: flag };
type Settings = { readonly [K in keyof typeof shape]: ReturnType<(typeof shape)[K]["parse"]> };
const source: Record<string, string | undefined> = { ALPHA: "1", GAMMA: "3", DELTA: "d", ZETA: "5" };
const proto = {
  names(this: object): string {
    return Object.keys(this).join();
  },
};
function makeTable(): Settings {
  const table = Object.create(proto);
  for (const [key, parser] of Object.entries(shape))
    Object.defineProperty(table, key, {
      get: makeGetter(key, parser as Parser<unknown>, source, table),
      enumerable: true,
      configurable: true,
    });
  return table as Settings;
}
const settings = makeTable();

const handedBack = new Function("v", "return v" + (source.ALPHA as string).slice(1)) as <V>(v: V) => V;
const seen = handedBack(settings);
(handedBack(function component() {}) as { displayName?: string }).displayName = "Component";

function isAlpha(): boolean {
  return settings.ALPHA;
}
function isBeta(): boolean {
  return settings.BETA && !settings.EPSILON;
}
function gamma(): number {
  return settings.GAMMA;
}
function hasDelta(): boolean {
  return settings.DELTA !== "";
}
function zetaOrEta(): number {
  return settings.ETA ? 1 : settings.ZETA;
}
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (isAlpha()) s++;
    if (isBeta()) s++;
    s += gamma();
    if (hasDelta()) s++;
    s += zetaOrEta();
  }
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check, Object.keys(seen).join());
