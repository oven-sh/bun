// A member of a locked built-in that is created at its first use is locked at that use already: Array.prototype.copyWithin, Number.prototype.toExponential and toFixed, Symbol.prototype.description and the static members Math.hypot, Date.UTC and Reflect.has refuse every change, whichever attempt touches them first, and their attributes read as in plain Bun. The same attempts on what is not fixed (the legacy members of RegExp, Intl.Segmenter.prototype, globalThis.WeakRef and console, a new name on Math) answer as in plain Bun.
const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = String(work());
  } catch (error) {
    text = "throws " + (error as Error).constructor.name;
  }
  lines.push(label + ": " + text);
}

function describeProperty(holder: any, name: string) {
  const descriptor = Object.getOwnPropertyDescriptor(holder, name)!;
  const kind = "value" in descriptor ? (descriptor.writable ? "writable data" : "read-only data") : "accessor";
  return kind + (descriptor.configurable ? ", configurable" : ", not configurable");
}

type Attempt = "assign" | "define" | "delete" | "Reflect.set" | "Object.values" | "describe" | "use";
type Use = (holder: any, name: string) => unknown;
// The holder is `any` and the name comes from a table, so neither the type checker nor the build knows which member is meant. `first` is the first use of the member in this program.
type Member = [path: string, holder: any, name: string, first: Attempt, use: Use];

const replacement = () => "replaced";

function attempt(kind: Attempt, holder: any, name: string, use: Use) {
  switch (kind) {
    case "assign":
      holder[name] = replacement;
      return "assigned";
    case "define":
      Object.defineProperty(holder, name, { value: replacement });
      return "defined";
    case "delete":
      return delete holder[name];
    case "Reflect.set":
      return Reflect.set(holder, name, replacement);
    case "Object.values":
      return Object.values(holder).length;
    case "describe":
      return describeProperty(holder, name);
    case "use":
      return use(holder, name);
  }
}

function attemptEach(members: Member[], kinds: Attempt[]) {
  for (const [path, holder, name, first, use] of members) {
    for (const kind of [first, ...kinds.filter(other => other !== first)]) {
      say(`${path}.${name}, ${kind}`, () => attempt(kind, holder, name, use));
    }
  }
}

attemptEach(
  [
    ["Array.prototype", Array.prototype, "copyWithin", "assign", (holder, name) => holder[name].call([1, 2, 3, 4], 0, 2).join()],
    ["Math", Math, "hypot", "delete", (holder, name) => holder[name](3, 4)],
    ["globalThis", globalThis, "WeakRef", "define", (holder, name) => new holder[name](lines).deref() === lines],
    ["Intl.Segmenter.prototype", Intl.Segmenter.prototype, "segment", "assign", (holder, name) => Array.from(holder[name].call(new Intl.Segmenter("en"), "ab"), (part: any) => part.segment).join("|")],
    ["Number.prototype", Number.prototype, "toExponential", "delete", (holder, name) => holder[name].call(1500, 1)],
    ["Date", Date, "UTC", "Reflect.set", (holder, name) => holder[name](2000, 0, 1)],
    ["Reflect", Reflect, "has", "describe", (holder, name) => holder[name]({ late: 1 }, "late")],
    ["Number.prototype", Number.prototype, "toFixed", "use", (holder, name) => holder[name].call(1.5, 2)],
  ],
  ["assign", "define", "delete", "Reflect.set", "describe", "use"],
);

attemptEach(
  [
    ["RegExp", RegExp, "input", "define", (holder, name) => ((holder[name] = "stored"), holder[name])],
    ["RegExp", RegExp, "multiline", "delete", (holder, name) => ((holder[name] = true), holder[name])],
    ["RegExp", RegExp, "lastParen", "describe", (holder, name) => typeof holder[name]],
    ["Symbol.prototype", Symbol.prototype, "description", "use", (holder, name) => (Symbol("late") as any)[name]],
  ],
  ["define", "delete", "describe", "use"],
);

attemptEach(
  [
    ["Number.prototype", Number.prototype, "toPrecision", "Object.values", (holder, name) => holder[name].call(1500, 2)],
    ["RegExp", RegExp, "rightContext", "Object.values", (holder, name) => typeof holder[name]],
    ["Intl.Segmenter.prototype", Intl.Segmenter.prototype, "resolvedOptions", "Object.values", (holder, name) => holder[name].call(new Intl.Segmenter("en")).granularity],
  ],
  ["Object.values", "describe", "use"],
);

function replaceAndRestore(holder: any, name: string) {
  const original = holder[name];
  holder[name] = replacement;
  const replaced = holder[name] === replacement;
  holder[name] = original;
  return replaced && holder[name] === original ? "replaced and restored" : "unchanged";
}

function addAndDelete(holder: any, name: string) {
  holder[name] = 1;
  return `${holder[name]}, ${delete holder[name]}, ${name in holder}`;
}

attemptEach([["globalThis", globalThis, "console", "describe", replaceAndRestore]], ["describe", "use"]);
attemptEach([["Math", Math, "added", "use", addAndDelete]], ["use"]);

console.log(lines.join("\n"));
