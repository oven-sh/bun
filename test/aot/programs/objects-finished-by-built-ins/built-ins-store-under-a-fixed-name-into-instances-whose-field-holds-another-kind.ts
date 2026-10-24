// Built-in functions that store under a fixed name into whatever object they are handed or make with a constructor they are handed.
const lines: string[] = [];
const say = (text: string): void => { lines.push(text); };
const show = (value: unknown): string => (typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value));
function attempt(label: string, run: () => void): void {
  try {
    run();
  } catch (error) {
    say(label + " threw " + (error as Error).name);
  }
}

class Counted {
  first = 1;
  length = "seven";
  last = 3;
  describe(): string {
    return this.first + " " + this.length.toUpperCase() + " " + this.last;
  }
}
class Cursor {
  first = 1;
  lastIndex = "start";
  flags = "g";
  last = 3;
  exec(_text: string): null {
    return null;
  }
  describe(): string {
    return this.first + " " + this.lastIndex.toUpperCase() + " " + this.last;
  }
}
class Traced {
  first = 1;
  stack = 2.5;
  last = 3;
  describe(): string {
    return this.first + " " + (this.stack + 1) + " " + this.last;
  }
}
class Listed {
  first = 1.5;
  length = 2.5;
  last = 3.5;
  total(): number {
    return this.first + this.length + this.last;
  }
}

function look(label: string, object: { describe(): string }): void {
  attempt(label, () => say(label + ": " + object.describe()));
}

const events: [string, () => void][] = [
  ["Array.from", () => { const made = (Array.from as Function).call(Counted, [1, 2]) as unknown as Counted; look("from", made); say(show(made.length) + " " + Object.keys(made).join()); }],
  ["Array.of", () => { const made = (Array.of as Function).call(Counted, 1, 2, 3) as unknown as Counted; look("of", made); say(show(made.length) + " " + Object.keys(made).join()); }],
  ["push", () => { const o = new Counted(); Array.prototype.push.call(o, 9); look("push", o); say(show(o.length) + " " + Object.keys(o).join()); }],
  ["pop", () => { const o = new Counted(); Array.prototype.pop.call(o); look("pop", o); say(show(o.length)); }],
  ["species", () => {
    const list = [1, 2, 3];
    (list as unknown as { constructor: unknown }).constructor = { [Symbol.species]: Counted };
    const made = list.map(x => x * 2) as unknown as Counted;
    look("map", made);
    say(show(made.length) + " " + Object.keys(made).join());
    const sliced = list.slice(1) as unknown as Counted;
    look("slice", sliced);
    say(show(sliced.length) + " " + Object.keys(sliced).join());
  }],
  ["match", () => { const o = new Cursor(); RegExp.prototype[Symbol.match].call(o as unknown as RegExp, "text"); look("match", o); say(show(o.lastIndex)); }],
  ["replace", () => { const o = new Cursor(); RegExp.prototype[Symbol.replace].call(o as unknown as RegExp, "text", () => "x"); look("replace", o); say(show(o.lastIndex)); }],
  ["search", () => { const o = new Cursor(); RegExp.prototype[Symbol.search].call(o as unknown as RegExp, "text"); look("search", o); say(show(o.lastIndex)); }],
  ["capture", () => { const o = new Traced(); (Error as unknown as { captureStackTrace(o: object): void }).captureStackTrace(o); attempt("capture", () => say("capture: " + typeof o.stack + " " + o.first + " " + o.last + " " + Object.keys(o).join())); }],
  ["listed", () => { const o = new Listed(); Array.prototype.push.call(o, "x"); say("listed: " + o.total() + " " + show(o.length)); const p = new Listed(); Array.prototype.fill.call(p, 1); say("filled: " + p.total()); }],
  ["listed-from", () => { const made = (Array.from as Function).call(Listed, { length: 3 }) as unknown as Listed; say("listed from: " + made.total() + " " + show(made.length)); }],
];

const chosen = events;
for (let turn = 0; turn < 3; turn++) {
  for (const [name, run] of chosen) attempt(name, run);
  look("plain", new Counted());
  look("plain", new Cursor());
  look("plain", new Traced());
  say("plain " + new Listed().total());
}
console.log(lines.join("\n"));
