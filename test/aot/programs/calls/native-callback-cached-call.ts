// Native functions that call a callback in a loop call compiled functions and functions created from text at run time alike, from compiled code and from such text, also when the callback throws.
type CalleeFactory = (kind: string) => any;
type Site = {
  label: string;
  name: string;
  logs: boolean;
  receiver(): any;
  args(make: CalleeFactory): any[];
  direct(receiver: any, args: any[]): any;
};
type Caller = (site: Site, receiver: any, args: any[]) => any;

const lines: string[] = [];

function show(value: any): string {
  if (typeof value === "string") {
    if (value.length <= 80) return JSON.stringify(value);
    return value.length + ":" + JSON.stringify(value.slice(0, 20)) + ".." + JSON.stringify(value.slice(-20));
  }
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return "[" + Array.from(value as any, show).join(",") + "]";
  if (value instanceof Set) return "Set[" + Array.from(value, show).join(",") + "]";
  if (value instanceof Map) {
    return "Map[" + Array.from(value, ([key, item]) => show(key) + "=>" + show(item)).join(",") + "]";
  }
  return "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join(",") + "}";
}

function errorText(action: () => unknown): string {
  try {
    return "returns " + show(action());
  } catch (error) {
    return String(error);
  }
}

class Fuse extends Error {}
let fuse = 0;
let calls: string[] = [];
let logsCalls = true;
let cursor = 0;
let other: number[] = [];

function answer(kind: string, args: any[]): any {
  if (logsCalls) calls.push(kind + "(" + show(args[0]) + "," + show(args[1]) + ")");
  if (fuse > 0 && --fuse === 0) throw new Fuse("in " + kind);
  switch (kind) {
    case "compare":
      return args[0] - args[1];
    case "replace":
      return "<" + args[0] + ">";
    case "positive":
      return args[0] > 0;
    case "double":
      return args[0] * 2;
    case "sum":
      return args[0] + args[1];
    case "length":
      return String(args[0]).length;
    case "has":
      return other.includes(args[0]);
    case "next":
      return cursor < other.length ? { done: false, value: other[cursor++] } : { done: true, value: undefined };
    default:
      throw new Error("no such kind: " + kind);
  }
}

// prettier-ignore
const withoutCaptures: Record<string, any> = {
  compare: function (...args: any[]) { return answer("compare", args); },
  replace: function (...args: any[]) { return answer("replace", args); },
  positive: function (...args: any[]) { return answer("positive", args); },
  double: function (...args: any[]) { return answer("double", args); },
  sum: function (...args: any[]) { return answer("sum", args); },
  length: function (...args: any[]) { return answer("length", args); },
  has: function (...args: any[]) { return answer("has", args); },
  next: function (...args: any[]) { return answer("next", args); },
};
const textCallback = new Function(
  "answer",
  "kind",
  "return function textCallback(...args) { return answer(kind, args); };",
);
const callees: [string, CalleeFactory][] = [
  ["closure", kind => (...args: any[]) => answer(kind, args)],
  ["no captures", kind => withoutCaptures[kind]],
  [
    "with properties",
    kind =>
      Object.assign(
        function tagged(...args: any[]) {
          return answer(kind, args);
        },
        { tag: kind },
      ),
  ],
  ["two parameters", kind => (a: any, b: any) => answer(kind, [a, b])],
  ["six parameters", kind => (a: any, b: any, c: any, d: any, e: any, f: any) => answer(kind, [a, b])],
  ["text", kind => textCallback(answer, kind)],
  [
    "compiled around text",
    kind => {
      const inner = textCallback(answer, kind);
      return (...args: any[]) => {
        const result = inner(...args);
        return result;
      };
    },
  ],
  ["bound", kind => ((boundKind: string, ...args: any[]) => answer(boundKind, args)).bind(null, kind)],
  ["proxy", kind => new Proxy((...args: any[]) => answer(kind, args), {})],
];

function byName(receiver: any, name: string, args: any[]): any {
  const result = receiver[name](...args);
  return result;
}
const fromText = new Function("receiver", "name", "args", "const result = receiver[name](...args); return result;");
const callers: [string, Caller][] = [
  ["direct", (site, receiver, args) => site.direct(receiver, args)],
  ["by name", (site, receiver, args) => byName(receiver, site.name, args)],
  ["from text", (site, receiver, args) => fromText(receiver, site.name, args)],
];

function createSite(
  label: string,
  name: string,
  kind: string,
  receiver: () => any,
  createArguments: (callback: any) => any[],
  direct: Site["direct"],
): Site {
  return { label, name, logs: kind !== "compare", receiver, args: make => createArguments(make(kind)), direct };
}

const setLike = (has: any, next: any) => ({
  size: other.length,
  has,
  keys() {
    return { next };
  },
});
function createSetSite(name: string, members: number[], direct: Site["direct"]): Site {
  return {
    label: name + ", " + members.length + " members",
    name,
    logs: true,
    receiver: () => new Set([1, 2, 3, 4]),
    args: make => {
      other = members;
      return [setLike(make("has"), make("next"))];
    },
    direct,
  };
}

const longSubject = "ab7".repeat(1500);
const longPattern = /b\d/g;
const unsorted = () => [5, 3, 9, 1, 7, 3, 0, -2];
const shorts = () => new Int16Array([1, -2, 3, 0]);
const only = (f: any) => [f];

// prettier-ignore
const sites: Site[] = [
  createSite("array sort", "sort", "compare", unsorted, only, (r, a) => r.sort(a[0])),
  createSite("array toSorted", "toSorted", "compare", unsorted, only, (r, a) => r.toSorted(a[0])),
  createSite("typed sort", "sort", "compare", () => new Int32Array(unsorted()), only, (r, a) => r.sort(a[0])),
  createSite("typed toSorted", "toSorted", "compare", () => new Float64Array([1.5, -0, 0, -3, 2.25]), only, (r, a) => r.toSorted(a[0])),
  createSite("replace", "replace", "replace", () => "a1b22c333", f => [/\d+/g, f], (r, a) => r.replace(a[0], a[1])),
  createSite("replace groups", "replace", "replace", () => "k1=v1;k2=v2", f => [/(\w+)=(\w+)/g, f], (r, a) => r.replace(a[0], a[1])),
  createSite("replace named", "replace", "replace", () => "2026-10-18 2027-01-02", f => [/(?<y>\d{4})-(?<m>\d\d)/g, f], (r, a) => r.replace(a[0], a[1])),
  createSite("replace long", "replace", "replace", () => longSubject, f => [longPattern, f], (r, a) => r.replace(a[0], a[1])),
  createSite("replaceAll", "replaceAll", "replace", () => "a.b.c", f => [".", f], (r, a) => r.replaceAll(a[0], a[1])),
  createSite("every", "every", "positive", shorts, only, (r, a) => r.every(a[0])),
  createSite("some", "some", "positive", shorts, only, (r, a) => r.some(a[0])),
  createSite("filter", "filter", "positive", shorts, only, (r, a) => r.filter(a[0])),
  createSite("find", "find", "positive", shorts, only, (r, a) => r.find(a[0])),
  createSite("findIndex", "findIndex", "positive", shorts, only, (r, a) => r.findIndex(a[0])),
  createSite("findLast", "findLast", "positive", shorts, only, (r, a) => r.findLast(a[0])),
  createSite("findLastIndex", "findLastIndex", "positive", shorts, only, (r, a) => r.findLastIndex(a[0])),
  createSite("forEach", "forEach", "double", shorts, only, (r, a) => r.forEach(a[0])),
  createSite("map", "map", "double", shorts, only, (r, a) => r.map(a[0])),
  createSite("reduce", "reduce", "sum", shorts, f => [f, 10], (r, a) => r.reduce(a[0], a[1])),
  createSite("reduceRight", "reduceRight", "sum", shorts, f => [f, 10], (r, a) => r.reduceRight(a[0], a[1])),
  createSite("getOrInsertComputed", "getOrInsertComputed", "length", () => new Map([["a", 1]]), f => ["bcd", f], (r, a) => r.getOrInsertComputed(a[0], a[1])),
];
const setMethods: [string, Site["direct"]][] = [
  ["union", (r, a) => r.union(a[0])],
  ["intersection", (r, a) => r.intersection(a[0])],
  ["difference", (r, a) => r.difference(a[0])],
  ["symmetricDifference", (r, a) => r.symmetricDifference(a[0])],
  ["isSubsetOf", (r, a) => r.isSubsetOf(a[0])],
  ["isSupersetOf", (r, a) => r.isSupersetOf(a[0])],
  ["isDisjointFrom", (r, a) => r.isDisjointFrom(a[0])],
];
for (const [name, direct] of setMethods) {
  sites.push(createSetSite(name, [2, 5], direct), createSetSite(name, [2, 3, 5, 6, 7, 8], direct));
}
const findSite = (label: string): Site => sites.find(site => site.label === label)!;

function run(site: Site, make: CalleeFactory, caller: Caller, blowAt: number): string {
  calls = [];
  cursor = 0;
  logsCalls = site.logs;
  fuse = blowAt;
  const receiver = site.receiver();
  const args = site.args(make);
  let outcome: string;
  try {
    outcome = show(caller(site, receiver, args));
  } catch (error: any) {
    outcome = "throws " + error.constructor.name + ": " + error.message;
  } finally {
    fuse = 0;
  }
  const seen = calls.length + " " + calls.slice(0, 3).join(" ") + " .. " + (calls.at(-1) ?? "");
  return outcome + " / " + show(receiver) + " | " + seen;
}

function compareAll(
  site: Site,
  candidates: [string, CalleeFactory][],
  blowAt: number,
  expected: string,
  reference: string,
): number {
  let agreeing = 0;
  const compare = (who: string, text: string, wanted: string): void => {
    if (text === wanted) agreeing++;
    else lines.push("  DIFFERS " + who + ": " + text);
  };
  for (const [calleeName, make] of candidates) {
    for (const [callerName, caller] of callers) {
      const who = calleeName + " / " + callerName;
      compare(who, run(site, make, caller, blowAt), expected);
      if (blowAt > 0) compare(who + ", next run", run(site, make, caller, 0), reference);
    }
  }
  return agreeing;
}

function checkSite(site: Site, candidates: [string, CalleeFactory][], fuses: number[]): void {
  const make = candidates[0][1];
  const reference = run(site, make, callers[0][1], 0);
  lines.push(site.label + ": " + reference);
  let agreeing = compareAll(site, candidates, 0, reference, reference);
  for (const blowAt of fuses) {
    const blown = run(site, make, callers[1][1], blowAt);
    lines.push(site.label + " blown at " + blowAt + ": " + blown);
    agreeing += compareAll(site, candidates, blowAt, blown, reference);
  }
  lines.push("  " + agreeing + " runs agree");
}

for (const site of sites) {
  if (site.name in Object(site.receiver())) checkSite(site, callees, [1, 2]);
  else lines.push(site.label + ": absent");
}

const notCallable: Site[] = [
  { ...findSite("array sort"), label: "sort, an object", receiver: () => [2, 1], args: () => [{}] },
  { ...findSite("map"), label: "map, a class", receiver: () => new Int8Array(2), args: () => [class NotCallable {}] },
  { ...findSite("replace"), label: "replace, a class", receiver: () => "a", args: () => [/a/g, class NotCallable {}] },
];
for (const site of notCallable) {
  for (const [callerName, caller] of callers) {
    const text = errorText(() => caller(site, site.receiver(), site.args(callees[0][1])));
    lines.push(site.label + " / " + callerName + ": " + text);
  }
}

const calleesReturningObjects: [string, CalleeFactory][] = [
  ["async function", kind => async (...args: any[]) => answer(kind, args)],
  [
    "generator function",
    kind =>
      function* (...args: any[]) {
        yield answer(kind, args);
      },
  ],
];
for (const label of ["forEach", "some"]) {
  for (const candidate of calleesReturningObjects) {
    checkSite({ ...findSite(label), label: label + ", " + candidate[0] }, [candidate], []);
  }
}

let depth = 0;
const nested: any = (...args: any[]) => {
  if (args[0] === "22" && depth < 2) {
    depth++;
    const inner = "a1b22c333".replace(/\d+/g, nested);
    depth--;
    return "[" + inner + "]";
  }
  return answer("replace", args);
};
const createNestedText = new Function(
  "answer",
  "var depth = 0; return function nestedText(...args) { if (args[0] === '22' && depth < 2) { depth++; var inner = 'a1b22c333'.replace(/\\d+/g, nestedText); depth--; return '[' + inner + ']'; } return answer('replace', args); };",
);
const nestedCallees: [string, CalleeFactory][] = [
  [
    "compiled",
    () => {
      depth = 0;
      return nested;
    },
  ],
  ["text", () => createNestedText(answer)],
];
checkSite({ ...findSite("replace"), label: "nested replace" }, nestedCallees, [4]);

class Adder {
  static add(a: number, b: number): number {
    return a + b;
  }
}
const callEach = new Function(
  "callees",
  "value",
  "var out = []; for (var turn = 0; turn < 50; turn++) for (var i = 0; i < callees.length; i++) out.push(callees[i](value + turn, 1)); return out.length + ':' + out.slice(-callees.length).join();",
);
logsCalls = false;
lines.push("one call site in text: " + callEach([...callees.map(([, make]) => make("sum")), Math.max, Adder.add], 100));

console.log(lines.join("\n"));
export {};
