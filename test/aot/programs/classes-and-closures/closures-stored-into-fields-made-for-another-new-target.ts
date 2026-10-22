// A class whose fields hold arrow functions, undefined and null is constructed for itself, for a class below it and for other functions.
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

class Part {
  label: string;
  first = () => 1;
  own = () => this.label + " owns";
  maybe: (() => string) | undefined = undefined;
  none: (() => string) | null = null;
  constructor(label: string, n: number) {
    this.label = label;
    if (n & 1) this.maybe = () => "maybe of " + this.label;
    if (n & 2) this.none = () => "none of " + this.label;
  }
}
class Below extends Part {
  more = () => this.own() + " and more";
  less: (() => string) | undefined = undefined;
}
function Plain(this: unknown) {}
class Stranger {
  strange = () => "strange";
}
function showPart(part: Part) {
  return [part.label, part.first(), part.own(), part.maybe === undefined ? "undefined" : part.maybe(), part.none === null ? "null" : part.none(), Object.keys(part).join("+")].join(" | ");
}
for (let n = 0; n < 4; n++) {
  say("part", n, showPart(new Part("part" + n, n)));
  const below = new Below("below" + n, n);
  say("below", n, showPart(below), below.more(), String(below.less), below.own === below.own);
  for (const target of [Part, Below, Plain, Stranger, Object]) {
    const made = Reflect.construct(Part, ["for " + target.name + n, n], target) as Part;
    say("for", target.name, n, showPart(made), made instanceof Part, made instanceof Below, Object.getPrototypeOf(made) === target.prototype, typeof (made as Below).more);
  }
}

console.log(lines.join("\n"));
