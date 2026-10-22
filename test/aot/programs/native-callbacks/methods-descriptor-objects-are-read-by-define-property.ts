// Methods found through instances: Object.defineProperty and Object.create read `get`, `value`, `enumerable` from a descriptor that is a class instance, through its accessors, and later run the getter they found on another object.
let total = 0;

class Descriptor {
  constructor(public held: number) {}
  get enumerable(): boolean {
    total += 1;
    return true;
  }
  get get(): (this: Descriptor) => number {
    total += 100;
    return read;
  }
}

function read(this: Descriptor): number {
  total += this instanceof Descriptor ? 10000 : 1000000;
  return typeof this.held === "number" ? this.held : -1;
}

const descriptor = new Descriptor(5);
const honest = read.call(descriptor);
const holder: any = Object.defineProperty({}, "a", descriptor);
const created: any = Object.create(null, { b: descriptor, c: descriptor });
const many: any = Object.defineProperties({ held: "text" }, { d: descriptor });
console.log(total, honest, holder.a, created.b + created.c, many.d, JSON.stringify(holder), Object.keys(created).join());
