const lines: string[] = [];

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}

function untypedBase(): unknown {
  return class {
    area(): number {
      return 2;
    }
  };
}

function isShape(x: unknown): x is Shape {
  try {
    return x instanceof Shape;
  } catch (error) {
    lines.push("isShape threw " + (error as Error).constructor.name);
    return false;
  }
}

function describe(s: Shape | Other): string {
  if (s instanceof Shape) return "shape " + s.area();
  if (s instanceof Other) return "other " + s.side;
  return "neither";
}

function takesPlain(p: Plain): string {
  return p === null ? "null" : typeof p;
}

function takesSubKeyed(k: SubKeyed): string {
  return k === undefined ? "undefined" : typeof k;
}

function takesMid(m: Mid): string {
  return m === null ? "null" : typeof m;
}

function takesSubIndex(k: SubIndex): string {
  return k === undefined ? "undefined" : typeof k;
}

function checkAll(label: string, probe: unknown): void {
  lines.push(label + " isShape " + isShape(probe));
  lines.push(label + " describe " + attempt(() => describe(probe as Shape | Other)));
  lines.push(label + " Keyed " + attempt(() => probe instanceof Keyed));
  lines.push(label + " SubKeyed " + attempt(() => probe instanceof SubKeyed));
  lines.push(label + " Plain " + attempt(() => probe instanceof Plain));
  lines.push(label + " takesPlain " + attempt(() => takesPlain(probe as Plain)));
  lines.push(label + " takesSubKeyed " + attempt(() => takesSubKeyed(probe as SubKeyed)));
  lines.push(label + " Mid " + attempt(() => probe instanceof Mid));
  lines.push(label + " SubIndex " + attempt(() => probe instanceof SubIndex));
  lines.push(label + " takesMid " + attempt(() => takesMid(probe as Mid)));
  lines.push(label + " takesSubIndex " + attempt(() => takesSubIndex(probe as SubIndex)));
}

checkAll("before", {});
lines.push("before null " + attempt(() => takesPlain(null as unknown as Plain)));
lines.push("before undefined " + attempt(() => takesSubKeyed(undefined as unknown as SubKeyed)));
lines.push("before new " + attempt(() => new Plain()));

class Shape extends (untypedBase() as any) {}
class Mid extends Shape {}
class Other {
  side = 3;
}
class Keyed {
  [Symbol.iterator](): Iterator<number> {
    return [1, 2][Symbol.iterator]();
  }
  #p(): number {
    return 4;
  }
  hidden(): number {
    return this.#p();
  }
}
class SubKeyed extends Keyed {
  own(): number {
    return 5;
  }
}
class SubIndex extends Keyed {
  0(): number {
    return 6;
  }
}
class Plain {}

checkAll("after", {});
checkAll("shape", new Shape());
checkAll("subKeyed", new SubKeyed());
checkAll("plain", new Plain());
checkAll("mid", new Mid());
checkAll("subIndex", new SubIndex());
lines.push(new SubIndex()[0]() + " " + new SubIndex().hidden());
lines.push("other " + describe(new Other()));
lines.push([...new SubKeyed()].join() + " " + new SubKeyed().hidden() + " " + new SubKeyed().own());
lines.push(String(Object.getPrototypeOf(new Plain()) === Plain.prototype));
lines.push(String(Object.getPrototypeOf(SubKeyed.prototype) === Keyed.prototype));

class Root {
  static made(): string {
    return "made by " + this.name;
  }
}
class Lazy1 extends Root {}
class Lazy2 extends Lazy1 {
  static second(): string {
    return "second of " + this.name;
  }
}
class Lazy3 extends Lazy2 {}
class Sibling extends Root {
  static declared(): string {
    return "declared";
  }
}

lines.push([Lazy3.made(), Lazy3.second(), Lazy1.made(), Object.getPrototypeOf(Lazy3) === Lazy2].join());
const lazy1 = Lazy1 as any;
const lazy3 = Lazy3 as any;
lines.push(String(lazy1.declared) + " " + Sibling.declared());
lines.push(String(lazy3.late) + " " + ("late" in Lazy3) + " " + ("missing" in Lazy3));
(Root as any).late = (): string => "late";
lines.push(lazy3.late() + " " + ("late" in Lazy3) + " " + ("missing" in Lazy3) + " " + Object.hasOwn(Lazy3, "late"));
lines.push(String(lazy1.declared) + " " + Object.getOwnPropertyNames(Sibling).includes("declared"));

console.log(lines.join("\n"));
