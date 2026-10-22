// Object.defineProperties gets a map of descriptors that is built at run time from a list of names:
// nothing in the text says which names arrive on the prototype. One is a field that is optional, one a field added late through a cast.
class Shape {
  declare kind: number;
  declare area?: number;
  constructor(kind: number) {
    this.kind = kind;
  }
}
interface Tagged extends Shape {
  tag?: string;
}
const log: string[] = [];
function area(shape: Shape) {
  return shape.area;
}
function setArea(shape: Shape, value: number) {
  shape.area = value;
}
function tag(shape: Shape) {
  return (shape as Tagged).tag;
}
function setTag(shape: Shape, value: string) {
  (shape as Tagged).tag = value;
}
function describe(shape: Shape) {
  return `${area(shape)} ${tag(shape)} ${"area" in shape} ${"tag" in shape} [${Object.keys(shape)}]`;
}
function descriptorsFor(names: string[]): PropertyDescriptorMap {
  const map: PropertyDescriptorMap = {};
  for (const name of names) {
    map[name] =
      name.length === 4
        ? { value: 44, writable: true, configurable: true, enumerable: false }
        : {
            get() {
              return "inherited " + name;
            },
            set(value) {
              log.push(`set ${name} ${value}`);
            },
            configurable: true,
          };
  }
  return map;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const shape = new Shape(i & 3);
  sum += area(shape) ?? 1;
  sum += tag(shape)?.length ?? 2;
  if (i & 1) setArea(shape, 3);
  if (i & 2) setTag(shape, "four");
  sum += (area(shape) ?? 1) + (tag(shape)?.length ?? 2);
}
console.log("warm", sum);

const empty = new Shape(1);
const filled = new Shape(2);
setArea(filled, 20);
setTag(filled, "own");
console.log("before:", describe(empty), "|", describe(filled));
Object.defineProperties(Shape.prototype, descriptorsFor("area tag".split(" ")));
const fresh = new Shape(3);
console.log("defined:", describe(empty), "|", describe(filled), "|", describe(fresh));
setArea(empty, 1);
setTag(empty, "t1");
setTag(filled, "t2");
setTag(fresh, "t3");
console.log("stored:", describe(empty), "|", describe(filled), "|", describe(fresh), "|", log.join(", "));
const names: string[] = [];
for (const name in fresh) names.push(name);
console.log("for-in:", names.join());
for (const name of Object.getOwnPropertyNames(Shape.prototype)) if (name !== "constructor") delete (Shape.prototype as any)[name];
console.log("gone again:", describe(empty), "|", describe(filled), "|", describe(fresh), "|", describe(new Shape(4)));
