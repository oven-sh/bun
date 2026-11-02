// Optional fields that hold numbers and booleans, defined without a value by the class: one function reads them from objects that stored them, that did not, that hold undefined or null, and that lost them.
const lines: string[] = [];
function often(label: string, body: (i: number) => unknown) {
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) seen.add(String(body(i)));
  lines.push(`${label}: ${[...seen].join(" ")}`);
}

class Options {
  id: number;
  width?: number;
  ratio?: number;
  wraps?: boolean;
  depth?: number;
  constructor(id: number, full: boolean) {
    this.id = id;
    if (full) {
      this.width = (id + 1) | 0;
      this.ratio = id + 0.5;
      this.wraps = (id & 1) === 0;
      this.depth = 2;
    }
  }
}
function describe(options: Options): string {
  const { width, ratio, wraps, depth } = options;
  let sum = 0;
  if (width !== undefined) sum += width;
  if (ratio !== undefined) sum += ratio;
  if (depth !== undefined) sum ^= depth;
  return `${width},${ratio},${wraps},${depth},${sum}`;
}
function has(options: Options): string {
  return `${"width" in options},${Object.hasOwn(options, "ratio")},${Object.keys(options).join("+")}`;
}

const full = new Options(4, true);
const empty = new Options(4, false);
often("full", () => describe(full));
often("empty", () => describe(empty));
often("both", i => describe(i & 1 ? full : empty));
often("fresh", i => describe(new Options(i & 3, (i & 4) === 0)));
often("has", i => has(i & 1 ? full : empty));

const later = new Options(1, false);
often("before the stores", () => describe(later));
later.depth = 9;
later.width = 3;
often("after two stores", () => `${describe(later)} ${has(later)}`);

const cleared = new Options(2, true);
cleared.width = undefined;
cleared.wraps = undefined;
(cleared as any).ratio = null;
often("undefined and null", () => `${describe(cleared)} ${has(cleared)}`);

const odd = new Options(3, true);
(odd as any).width = "wide";
(odd as any).depth = 1.5;
often("other types", () => describe(odd));

const lost = new Options(5, true);
delete lost.width;
delete lost.wraps;
often("deleted", () => `${describe(lost)} ${has(lost)}`);

const computed = new Options(6, false);
Object.defineProperty(computed, "width", { get: () => 77, configurable: true });
often("an own getter", i => describe(i & 1 ? computed : empty));

class Narrow extends Options {
  margin?: number;
}
often("a subclass", i => describe(new Narrow(i & 1, (i & 2) === 0)) + new Narrow(1, true).margin);

const names = ["width", "wraps"];
const holder = Options.prototype as any;
for (const name of names) holder[name] = name.length;
often("inherited", i => describe(i & 1 ? full : empty));
often("inherited, fresh", i => describe(new Options(1, (i & 1) === 0)));
often("inherited, has", i => has(i & 1 ? full : empty));
often("inherited, below", () => describe(new Narrow(1, false)));
for (const name of names) delete holder[name];
often("no longer inherited", i => describe(i & 1 ? full : empty));

const relinked = new Options(7, false);
Object.setPrototypeOf(relinked, { ratio: 0.25, depth: 8 });
often("linked elsewhere", i => describe(i & 1 ? relinked : empty));

console.log(lines.join("\n"));
