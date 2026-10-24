// Subclasses of Map, Array and Error have optional fields. The names arrive on the prototypes of the subclasses, not of the built-ins.
// The instances are cells of the built-in kinds, so their fields may live elsewhere than in the slots of an ordinary object.
const log: string[] = [];
class Registry extends Map<string, number> {
  declare owner?: string;
}
class Stack extends Array<number> {
  declare limit?: number;
}
class Failure extends Error {
  declare code?: number;
}
function ownerOf(registry: Registry) {
  return registry.owner;
}
function limitOf(stack: Stack) {
  return stack.limit;
}
function codeOf(failure: Failure) {
  return failure.code;
}
function fill(registry: Registry, stack: Stack, failure: Failure) {
  registry.owner = "me";
  stack.limit = 4;
  failure.code = 404;
}
function state(registry: Registry, stack: Stack, failure: Failure) {
  return `${ownerOf(registry)} ${limitOf(stack)} ${codeOf(failure)} [${Object.keys(registry)}] [${Object.keys(stack)}] [${Object.keys(failure)}]`;
}
function trio(): [Registry, Stack, Failure] {
  const stack = new Stack();
  stack.push(1, 2);
  return [new Registry([["a", 1]]), stack, new Failure("failed")];
}

let length = 0;
for (let i = 0; i < 2000; i++) {
  const three = trio();
  length += state(...three).length;
  if (i & 1) fill(...three);
  length += state(...three).length;
}
console.log("warm", length);

const empty = trio();
const filled = trio();
fill(...filled);
const key = (text: string) => JSON.parse(JSON.stringify(text)) as string;
(Registry.prototype as any)[key("owner")] = "everyone";
Object.defineProperty(Stack.prototype, key("limit"), {
  get(this: Stack) {
    return this.length * 10;
  },
  set(this: Stack, value: number) {
    log.push(`limit ${value} on a stack of ${this.length}`);
  },
  configurable: true,
});
Object.defineProperty(Failure.prototype, key("code"), { value: 500, writable: false, configurable: true });
console.log("inherited:", state(...empty), "|", state(...filled), "|", state(...trio()));
try {
  fill(...empty);
} catch (error) {
  console.log("the store of the code:", (error as Error).constructor.name);
}
console.log("after the stores:", state(...empty), "|", log.join(", "));
console.log("still themselves:", empty[0].get("a"), empty[1].length, empty[1].map(n => n * 2) instanceof Stack, empty[2].message, empty[2] instanceof Failure);
delete (Registry.prototype as any).owner;
delete (Stack.prototype as any).limit;
delete (Failure.prototype as any).code;
console.log("gone again:", state(...empty), "|", state(...trio()));
fill(...empty);
console.log("filled:", state(...empty), log.length);
