type Listener = () => string;
type Held = Listener | Listener[] | undefined;
interface Events {
  [name: string]: Held;
  close: Held;
  error: Held;
  data: Held;
}
interface Changed {
  [name: string]: Held;
  close: Held;
  error: Held;
  data: Held;
  changed: Held;
}
interface Loose {
  [name: string]: Held;
  close: Held;
  error: Held;
  data: Held;
  loose: Held;
}
class Point {
  constructor(public x: number) {}
}
interface Shelf {
  [name: string]: unknown;
  point: Point | undefined;
  list: number[];
  count: number;
  ratio: number;
  open: boolean;
  mode: "read" | "write";
  label: string;
}
interface LooseShelf {
  [name: string]: unknown;
  point: Point | undefined;
  list: number[];
  count: number;
  ratio: number;
  open: boolean;
  mode: "read" | "write";
  label: string;
  loose: boolean;
}
const hide = <T>(value: T): T => new CustomEvent("hidden", { detail: value }).detail;
const names = ["close", "error", "finish", "data", "drain"];
const first: Listener = () => "first";
const second: Listener = () => "second";
const lines: string[] = [];

function show(held: unknown): string {
  if (typeof held === "function") return "function " + held();
  if (Array.isArray(held)) return "[" + held.map(show).join(", ") + "]";
  if (held instanceof Point) return "Point " + held.x;
  return typeof held + " " + String(held);
}
function listing(object: object): string {
  return Object.keys(object)
    .map(name => name + ": " + show((object as any)[name]))
    .join("; ");
}
function room(): Events {
  return { close: undefined, error: undefined, data: undefined };
}
function add(events: Events | Changed, type: string, listener: Listener) {
  const existing = events[type];
  if (existing === undefined) events[type] = listener;
  else events[type] = typeof existing === "function" ? [existing, listener] : [...existing, listener];
}
function filled(rounds: number): Events {
  const events = room();
  for (let round = 0; round < rounds; round++) for (const name of names) add(events, name, round & 1 ? second : first);
  return events;
}

function roomToChange(): Changed {
  const events: Changed = { close: undefined, error: undefined, data: undefined, changed: undefined };
  for (const name of names) add(events, name, first);
  return events;
}
function otherRoom(): Loose {
  return { close: undefined, error: undefined, data: undefined, loose: undefined };
}
function put(events: Loose, type: string, value: unknown) {
  (events as any)[type] = value;
}
function filledWithAnything(): Loose {
  const events = otherRoom();
  const values: unknown[] = [first, 7, [second], "text", null, 1.5, new Point(3), true, undefined, second];
  const seen: string[] = [];
  for (const value of values) {
    for (const name of names) put(events, name, value);
    seen.push(show(events.close) + " | " + show(events.data) + " | " + show(events.drain));
  }
  lines.push("anything: " + seen.join(" ; "));
  return events;
}

function shelf(): Shelf {
  return { point: undefined, list: [], count: 0, ratio: 0.5, open: false, mode: "read", label: "" };
}
function set<Name extends keyof Shelf>(target: Shelf, name: Name, value: Shelf[Name]) {
  target[name] = value;
}
function filledShelf(rounds: number): Shelf {
  const target = shelf();
  for (let round = 0; round < rounds; round++) {
    set(target, "point", round % 3 ? new Point(round) : undefined);
    set(target, "list", [round, round + 1]);
    set(target, "count", round * 3);
    set(target, "ratio", round / 4);
    set(target, "open", round % 2 === 0);
    set(target, "mode", round % 2 ? "write" : "read");
    set(target, "label", "round " + round);
  }
  return target;
}
function hiddenShelf(): LooseShelf {
  const target: LooseShelf = { point: undefined, list: [], count: 0, ratio: 0.5, open: false, mode: "read", label: "", loose: true };
  const pairs: [string, unknown][] = [
    ["point", "no point"],
    ["list", 4],
    ["count", "many"],
    ["ratio", null],
    ["open", 1],
    ["mode", "append"],
    ["label", undefined],
    ["count", 2 ** 40],
    ["count", -0],
    ["extra", first],
  ];
  const seen: string[] = [];
  for (let round = 0; round < 3; round++) {
    for (const [name, value] of pairs) {
      (target as any)[hide(name)] = hide(value);
      seen.push(name + " " + show(target[name]));
    }
  }
  lines.push("hidden: " + seen.slice(-pairs.length).join("; "));
  return target;
}

class Emitter {
  events: Events = { close: undefined, error: undefined, data: undefined };
  early = ((this.events[names[0]] = first), (this.events[names[2]] = second), listing(this.events));
  on(type: string, listener: Listener) {
    this.events[type] = listener;
    return this;
  }
  static all(rounds: number) {
    const emitter = new Emitter();
    for (let round = 0; round < rounds; round++) for (const name of names) emitter.on(name, round & 1 ? first : second);
    return emitter;
  }
}

function attempt(run: () => void): string {
  try {
    run();
    return "stored";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function changed(): string[] {
  const results: string[] = [];
  const frozen = Object.freeze(roomToChange());
  results.push("frozen " + attempt(() => add(frozen, "close", second)) + " " + listing(frozen));
  const sealed = Object.seal(roomToChange());
  results.push("sealed " + attempt(() => add(sealed, "close", second)) + " " + attempt(() => add(sealed, "pause", second)) + " " + listing(sealed));
  const shorter = roomToChange();
  delete (shorter as any).error;
  for (let round = 0; round < 3; round++) add(shorter, "error", second);
  results.push("deleted " + listing(shorter));
  const readOnly = roomToChange();
  Object.defineProperty(readOnly, "data", { value: second, writable: false });
  results.push("read-only " + attempt(() => add(readOnly, "data", first)) + " " + listing(readOnly));
  const watched = roomToChange();
  let stores = 0;
  Object.defineProperty(watched, "close", {
    get: () => undefined,
    set: () => void stores++,
    enumerable: true,
  });
  for (let round = 0; round < 3; round++) add(watched, "close", first);
  results.push("setter " + stores + " " + listing(watched));
  const below = Object.create(roomToChange()) as Changed;
  for (let round = 0; round < 2; round++) add(below, "close", second);
  results.push("below " + listing(below) + " above " + listing(Object.getPrototypeOf(below)));
  return results;
}

const atTopLevel: Events = { close: undefined, error: undefined, data: undefined };
for (let round = 0; round < 4; round++) for (const name of names) atTopLevel[name] = round < 2 ? first : [first, second];

lines.push("function: " + listing(filled(0)), "function: " + listing(filled(1)), "function: " + listing(filled(3)));
lines.push("anything: " + listing(filledWithAnything()));
lines.push("shelf: " + listing(filledShelf(1)), "shelf: " + listing(filledShelf(6)));
lines.push("hidden: " + listing(hiddenShelf()));
lines.push("field: " + new Emitter().early, "method: " + listing(Emitter.all(3).events));
lines.push(...changed());
lines.push("top level: " + listing(atTopLevel));
console.log(lines.join("\n"));
