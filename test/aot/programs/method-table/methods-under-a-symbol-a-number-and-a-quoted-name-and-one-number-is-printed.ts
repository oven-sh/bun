// Methods whose names are no identifiers: a symbol, a number and a name with a blank. A subclass overrides all three and they are called through the type of the base. Then each is replaced on another class of the family. One number is printed.
const tag = Symbol("tag");

class Plain {
  constructor(public n: number) {}
  [tag](): number {
    return this.n;
  }
  0(): number {
    return this.n + 1;
  }
  "two words"(): number {
    return this.n + 2;
  }
}
class Named extends Plain {
  [tag](): number {
    return this.n * 10;
  }
  0(): number {
    return this.n * 20;
  }
  "two words"(): number {
    return this.n * 30;
  }
}
class Below extends Named {}

function underTheSymbol(x: Plain): number {
  return x[tag]();
}
function underTheNumber(x: Plain): number {
  return x[0]();
}
function underTheQuotedName(x: Plain): number {
  return x["two words"]();
}

let checksum = 0;
function note(value: number): void {
  checksum = (Math.imul(checksum, 31) + value) | 0;
}

const list: Plain[] = [new Plain(1), new Named(2), new Below(3)];

function round(): void {
  for (const x of list) note(underTheSymbol(x));
  for (const x of list) note(underTheNumber(x));
  for (const x of list) note(underTheQuotedName(x));
}

round();
Named.prototype[tag] = () => 7;
Plain.prototype[0] = () => 8;
Named.prototype["two words"] = () => 9;
round();
Reflect.deleteProperty(Named.prototype, tag);
Reflect.deleteProperty(Named.prototype, 0);
Reflect.deleteProperty(Named.prototype, "two words");
round();
console.log(checksum);

export {};
