// structuredClone refuses an object with a function member whether the function object exists yet or not, and copies undefined and null as they are.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}
function attempt(action: () => unknown) {
  try {
    return String(action());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

interface Kit {
  label: string;
  first: () => number;
  own: () => string;
  maybe: (() => string) | undefined;
  none: (() => string) | null;
}
// n & 1: `maybe` is a function, else undefined. n & 2: `none` is a function, else null.
function kit(label: string, n: number): Kit {
  const made = {
    label,
    first: () => 1,
    maybe: n & 1 ? () => "maybe" : undefined,
    none: n & 2 ? () => "none" : null,
  } as Kit;
  made.own = () => made.label + " owns";
  return made;
}
function show(kit: Kit) {
  return [kit.label, kit.first(), kit.own(), kit.maybe === undefined ? "undefined" : kit.maybe(), kit.none === null ? "null" : kit.none(), Object.keys(kit).join("+")].join(" | ");
}

interface Optional {
  label: string;
  maybe: (() => string) | undefined;
  none: (() => string) | null;
}
function optional(label: string, n: number): Optional {
  return { label, maybe: n & 1 ? () => "maybe" : undefined, none: n & 2 ? () => "none" : null };
}
for (let n = 0; n < 4; n++) {
  const source = optional("source" + n, n);
  const outcome = attempt(() => {
    const clone = structuredClone(source);
    return [clone.label, String(clone.maybe), String(clone.none), Object.keys(clone).join("+"), clone !== source].join(" | ");
  });
  say("optional", n, outcome, typeof source.maybe, typeof source.none);
  say("kit", n, attempt(() => structuredClone(kit("kit" + n, n))));
  say("inside", n, attempt(() => JSON.stringify(structuredClone({ list: [optional("in" + n, 0)], map: new Map([["k", optional("map" + n, 0)]]) }).list)));
}
const channel = new MessageChannel();
say("post", attempt(() => channel.port1.postMessage(kit("posted", 0))), attempt(() => channel.port1.postMessage(optional("posted", 0))));
channel.port1.close();
channel.port2.close();

console.log(lines.join("\n"));
