// `constructor` of the prototype of each collection, error and function class is the class itself. Iterator.prototype has an accessor, and the prototypes of generator objects lead to a prototype.
export {};

function show(label: string, ...values: unknown[]): void {
  console.log(label + ": " + values.map(value => String(value)).join(" "));
}

function attempt(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

function constructorOfMap(map: Map<string, number>): Function {
  return map.constructor;
}
function constructorOfSet(set: Set<string>): Function {
  return set.constructor;
}
function constructorOfError(error: Error): Function {
  return error.constructor;
}
function constructorOfFunction(f: () => void): Function {
  return f.constructor;
}
function constructorOfAnything(value: any): unknown {
  return value.constructor;
}

function describeClass(name: string, classObject: any, instance: any): void {
  const prototype = classObject.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  show(name, prototype.constructor === classObject, descriptor?.value === classObject, descriptor?.enumerable, instance.constructor === classObject, Object.hasOwn(instance, "constructor"), constructorOfAnything(instance) === classObject);
}

show("a Map", constructorOfMap(new Map()) === Map, new Map().constructor === Map, Map.prototype.constructor === Map, constructorOfMap(new Map()) === Set, new (constructorOfMap(new Map()) as any)([["a", 1]]).get("a"));
show("a Set", constructorOfSet(new Set()) === Set, new Set().constructor === Set, Set.prototype.constructor === Set, constructorOfSet(new Set()) === Map, new (constructorOfSet(new Set()) as any)(["a"]).has("a"));

describeClass("Map", Map, new Map());
describeClass("Set", Set, new Set());
describeClass("WeakMap", WeakMap, new WeakMap());
describeClass("WeakSet", WeakSet, new WeakSet());
describeClass("WeakRef", WeakRef, new WeakRef({}));
describeClass("FinalizationRegistry", FinalizationRegistry, new FinalizationRegistry(() => {}));
describeClass("DisposableStack", DisposableStack, new DisposableStack());

const errorClasses: any[] = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError];
for (const errorClass of errorClasses) describeClass(errorClass.name, errorClass, new errorClass("message"));
describeClass("AggregateError", AggregateError, new AggregateError([]));
describeClass("SuppressedError", SuppressedError, new SuppressedError(1, 2));
show("an error", constructorOfError(new Error("e")) === Error, constructorOfError(new TypeError("e")) === TypeError, constructorOfError(new TypeError("e")) === Error, constructorOfError(new RangeError("e")).name);

const replaced: any = RangeError.prototype;
const original = replaced.constructor;
replaced.constructor = Map;
show("the prototype of an error class is not locked", constructorOfError(new RangeError("e")) === Map, constructorOfAnything(new RangeError("e")) === Map, constructorOfError(new TypeError("e")) === TypeError);
replaced.constructor = original;
show("put back", constructorOfError(new RangeError("e")) === RangeError);

class Failure extends Error {}
show("a subclass of Error", constructorOfError(new Failure("e")) === Failure, Object.getPrototypeOf(Failure.prototype).constructor === Error);
class Registry extends Map<string, number> {}
show("a subclass of Map", constructorOfMap(new Registry()) === Registry, constructorOfMap(new Registry()) === Map, Object.getPrototypeOf(Registry.prototype).constructor === Map);
const shadowed = new Map<string, number>();
Object.defineProperty(shadowed, "constructor", { value: Set });
show("an own property", constructorOfMap(shadowed) === Set, constructorOfMap(new Map()) === Map);

function plain(): void {}
async function later(): Promise<void> {}
function* steps(): Generator<number> {}
async function* laterSteps(): AsyncGenerator<number> {}
const AsyncFunction = Object.getPrototypeOf(later).constructor;
const GeneratorFunction = Object.getPrototypeOf(steps).constructor;
const AsyncGeneratorFunction = Object.getPrototypeOf(laterSteps).constructor;
show("functions", constructorOfFunction(plain) === Function, constructorOfFunction(() => {}) === Function, Function.prototype.constructor === Function, Math.max.constructor === Function, Map.constructor === Function);
show("other kinds of functions", constructorOfAnything(later) === AsyncFunction, constructorOfAnything(steps) === GeneratorFunction, constructorOfAnything(laterSteps) === AsyncGeneratorFunction);
show("are not Function", AsyncFunction === Function, GeneratorFunction === Function, AsyncGeneratorFunction === Function, constructorOfFunction(later as any) === Function);
show("their names", AsyncFunction.name, GeneratorFunction.name, AsyncGeneratorFunction.name, Object.getPrototypeOf(AsyncFunction) === Function);
show("their prototypes", AsyncFunction.prototype === Object.getPrototypeOf(later), GeneratorFunction.prototype === Object.getPrototypeOf(steps), AsyncGeneratorFunction.prototype === Object.getPrototypeOf(laterSteps));

const generatorPrototype = Object.getPrototypeOf(steps.prototype);
const asyncGeneratorPrototype = Object.getPrototypeOf(laterSteps.prototype);
show("generator objects", generatorPrototype.constructor === GeneratorFunction.prototype, constructorOfAnything(steps()) === GeneratorFunction.prototype, Object.hasOwn(steps.prototype, "constructor"), typeof generatorPrototype.constructor);
show("async generator objects", asyncGeneratorPrototype.constructor === AsyncGeneratorFunction.prototype, constructorOfAnything(laterSteps()) === AsyncGeneratorFunction.prototype, typeof asyncGeneratorPrototype.constructor);

const IteratorClass = (globalThis as any).Iterator;
const iteratorPrototype: any = Object.getPrototypeOf(Object.getPrototypeOf([].values()));
const iteratorDescriptor = Object.getOwnPropertyDescriptor(iteratorPrototype, "constructor");
show("Iterator.prototype", iteratorPrototype === IteratorClass.prototype, typeof iteratorDescriptor?.get, typeof iteratorDescriptor?.set, iteratorDescriptor?.enumerable, iteratorPrototype.constructor === IteratorClass);
show("iterators", constructorOfAnything([].values()) === IteratorClass, constructorOfAnything(new Map().keys()) === IteratorClass, constructorOfAnything(new Set().values()) === IteratorClass, constructorOfAnything(""[Symbol.iterator]()) === IteratorClass);
const iterator: any = [1].values();
iterator.constructor = Map;
show("stored on an iterator", Object.hasOwn(iterator, "constructor"), iterator.constructor === Map, constructorOfAnything([].values()) === IteratorClass, iterator.next().value);
show("stored on Iterator.prototype", attempt(() => (iteratorPrototype.constructor = Map)), iteratorPrototype.constructor === IteratorClass);

const intlClasses: any[] = [Intl.Collator, Intl.DateTimeFormat, Intl.DisplayNames, Intl.ListFormat, Intl.Locale, Intl.NumberFormat, Intl.PluralRules, Intl.RelativeTimeFormat, Intl.Segmenter];
show("Intl", ...intlClasses.map(intlClass => intlClass.prototype.constructor === intlClass));
show("an Intl object", new Intl.Collator().constructor === Intl.Collator, new Intl.Locale("en").constructor === Intl.Locale, constructorOfAnything(new Intl.PluralRules()) === Intl.PluralRules);
const webAssemblyClasses: any[] = [WebAssembly.Global, WebAssembly.Instance, WebAssembly.Memory, WebAssembly.Module, WebAssembly.Table, WebAssembly.CompileError, WebAssembly.LinkError, WebAssembly.RuntimeError];
show("WebAssembly", ...webAssemblyClasses.map(webAssemblyClass => webAssemblyClass.prototype.constructor === webAssemblyClass));
show("a WebAssembly error", constructorOfError(new WebAssembly.CompileError("e")) === WebAssembly.CompileError, Object.getPrototypeOf(WebAssembly.CompileError) === Error);
