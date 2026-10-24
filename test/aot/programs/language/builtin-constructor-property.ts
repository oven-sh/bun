// `constructor` of a string and of a typed array is the class itself: compared, called, constructed with, read from the prototype, from an instance and through any.
export {};

function show(label: string, ...values: unknown[]): void {
  console.log(label + ": " + values.map(value => String(value)).join(" "));
}

function constructorOfText(text: string): Function {
  return text.constructor;
}
function constructorOfFloats(view: Float32Array): Function {
  return view.constructor;
}
function constructorOfAnything(value: any): unknown {
  return value.constructor;
}
function allocateSameKind(view: Float32Array, length: number): any {
  return new (view.constructor as any)(length);
}
function isText(value: string | Uint8Array): boolean {
  return value.constructor === String;
}

show("a string", constructorOfText("a") === String, "".constructor === String, `${1}`.constructor === String, constructorOfAnything("a") === String);
show("the prototype of strings", String.prototype.constructor === String, Object.hasOwn(String.prototype, "constructor"), String.prototype.constructor.name, String.prototype.constructor.length);
show("a String object", new String("a").constructor === String, Object.hasOwn(new String("a"), "constructor"));
show("called", constructorOfText("a")(5), typeof constructorOfText("a")(5), typeof new (constructorOfText("a") as any)(5), ("" as any).constructor.fromCharCode(65, 66));
show("other classes", constructorOfText("a") === Object, constructorOfText("a") === Number, (5).constructor === String, isText("a"), isText(new Uint8Array(1)));

const floats = new Float32Array(4);
const more: Float32Array = allocateSameKind(floats, 8);
show("a typed array", constructorOfFloats(floats) === Float32Array, floats.constructor === Float32Array, constructorOfAnything(floats) === Float32Array);
show("allocated with it", more.length, more instanceof Float32Array, more.constructor === Float32Array, more.BYTES_PER_ELEMENT, more[7]);
show("other classes", floats.constructor === Float64Array, floats.constructor === Object, floats.constructor === Array);

const constructors: any[] = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float16Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array];
for (const constructor of constructors) {
  const view = new constructor(2);
  const copy = new (view.constructor as any)(3);
  show(constructor.name, view.constructor === constructor, constructor.prototype.constructor === constructor, Object.hasOwn(constructor.prototype, "constructor"), Object.hasOwn(view, "constructor"), copy.length, copy.constructor === constructor);
}

const sharedConstructor = Object.getPrototypeOf(Int8Array);
const sharedPrototype = Object.getPrototypeOf(Int8Array.prototype);
show("the shared class", sharedPrototype.constructor === sharedConstructor, sharedConstructor.prototype === sharedPrototype, Object.hasOwn(sharedPrototype, "constructor"), sharedPrototype.constructor.name, sharedPrototype.constructor === Int8Array, sharedPrototype.constructor === Object.getPrototypeOf(Float64Array));
try {
  new sharedPrototype.constructor(1);
  show("the shared class constructed", "no error");
} catch (error) {
  show("the shared class constructed", error instanceof TypeError);
}

class Samples extends Float32Array {}
const samples = new Samples(1);
show("a subclass", samples.constructor === Samples, samples.constructor === Float32Array, allocateSameKind(samples, 2) instanceof Samples, Object.getPrototypeOf(Samples.prototype).constructor === Float32Array);
show("a Buffer", Buffer.alloc(1).constructor === Buffer, Buffer.alloc(1).constructor === Uint8Array);

const shadowed = new Float32Array(1);
Object.defineProperty(shadowed, "constructor", { value: Int8Array });
show("an own property", constructorOfFloats(shadowed) === Int8Array, allocateSameKind(shadowed, 2) instanceof Int8Array, constructorOfFloats(floats) === Float32Array);
