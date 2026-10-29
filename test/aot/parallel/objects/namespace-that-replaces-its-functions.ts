// A namespace that replaces one of its own functions at the first call, under a computed name, as assertion libraries do. Its other members are read as before.
function noop(_?: unknown): void {}
namespace Debug {
  export let level = 0;
  export let isDebugging = false;
  export let host: { log(text: string): void } | undefined;
  const cache: Partial<Record<"assertNode" | "assertEach", { assertion: unknown }>> = {};
  function shouldAssert(name: "assertNode" | "assertEach"): boolean {
    if (level < 1) {
      cache[name] = { assertion: Debug[name] };
      (Debug as any)[name] = noop;
      return false;
    }
    return true;
  }
  export function assertNode(node: unknown, message?: string): void {
    if (shouldAssert("assertNode") && !node) throw new Error(message ?? "no node");
  }
  export function assertEach(nodes: readonly unknown[], message?: string): void {
    if (shouldAssert("assertEach") && !nodes.every(Boolean)) throw new Error(message ?? "no nodes");
  }
}
interface Type { flags: number; id: number; checker?: object }
function Type(this: Type, checker: object, flags: number) {
  this.flags = flags;
  if (Debug.isDebugging || Debug.host) this.checker = checker;
}
const TypeConstructor = Type as unknown as new (checker: object, flags: number) => Type;
const checker = {};
let count = 0;
function createType(flags: number): Type {
  const type = new TypeConstructor(checker, flags);
  type.id = ++count;
  return type;
}
let sum = 0;
for (let round = 0; round < 2000000; round++) {
  const type = createType(round & 15);
  if (round === 10) { Debug.assertNode(type); Debug.assertEach([type]); }
  sum += type.flags + (type.checker ? 1 : 0);
}
console.log(sum, count, Debug.assertNode === noop, Debug.assertEach === noop, Debug.isDebugging, Object.keys(Debug).join());
Debug.isDebugging = true;
console.log(createType(3).checker === checker);
