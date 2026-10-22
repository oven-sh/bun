// toString, valueOf and hasOwnProperty: the base class leaves them to Object.prototype and only a subclass defines them, so one call site finds a built-in for some receivers and a method of a class for others. They are called by name and through conversions, then replaced and deleted.
class Plain {
  constructor(public n: number) {}
}
class Named extends Plain {
  toString(): string {
    return "n" + this.n;
  }
  valueOf(): number {
    return this.n * 40;
  }
  hasOwnProperty(): boolean {
    return false;
  }
}
class Below extends Named {}

function byName(x: Plain): number {
  return x.toString().length * 10 + Number(x.hasOwnProperty("n"));
}
function inATemplate(x: Plain): number {
  return `${x}`.length;
}
function converted(x: Named): number {
  return x.valueOf() + Number(x) + +x;
}

function note(label: string, value: number): void {
  console.log(label + ": " + value);
}

const list: Plain[] = [new Plain(1), new Named(2), new Below(3)];

function round(): void {
  for (const x of list) note("by name", byName(x));
  for (const x of list) note("in a template", inATemplate(x));
  note("conversions", converted(new Named(2)) + converted(new Below(3)));
}

round();
Named.prototype.toString = () => "a longer text";
Named.prototype.valueOf = () => 5;
Named.prototype.hasOwnProperty = () => true;
round();
Reflect.deleteProperty(Named.prototype, "toString");
Reflect.deleteProperty(Named.prototype, "hasOwnProperty");
round();

export {};
