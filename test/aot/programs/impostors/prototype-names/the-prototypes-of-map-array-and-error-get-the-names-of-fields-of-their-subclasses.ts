// The optional fields belong to subclasses of Map, Array and Error; the names arrive on Map.prototype, Array.prototype and Error.prototype themselves,
// by a store the build can see and by a store under a computed key. Whether the change succeeds or is refused is printed, and what the instances read must agree with it.
// Under --aot the store that the build cannot attribute is refused: the program was compiled to find that these prototypes lack the name. The .expected.txt and .erased.txt hold that answer.
class Registry extends Map<string, number> {
  declare owner?: string;
  declare region?: string;
}
class Stack extends Array<number> {
  declare owner?: string;
  declare region?: string;
}
class Failure extends Error {
  declare owner?: string;
  declare region?: string;
}
type Owned = { owner?: string; region?: string };
function ownerOfRegistry(object: Registry) {
  return `${object.owner} ${object.region}`;
}
function ownerOfStack(object: Stack) {
  return `${object.owner} ${object.region}`;
}
function ownerOfFailure(object: Failure) {
  return `${object.owner} ${object.region}`;
}
function attempt(run: () => void) {
  try {
    run();
    return "changed";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
function all() {
  return `${ownerOfRegistry(registry)} / ${ownerOfRegistry(new Registry())} | ${ownerOfStack(stack)} / ${ownerOfStack(new Stack())} | ${ownerOfFailure(failure)} / ${ownerOfFailure(new Failure("f"))}`;
}

let length = 0;
for (let i = 0; i < 2000; i++) {
  const three: Owned[] = [new Registry(), new Stack(), new Failure("f")];
  if (i & 1) for (const object of three) object.owner = "me";
  length += ownerOfRegistry(three[0] as Registry).length + ownerOfStack(three[1] as Stack).length + ownerOfFailure(three[2] as Failure).length;
}
console.log("warm", length);

const registry = new Registry();
const stack = new Stack();
const failure = new Failure("f");
console.log("before:", all());
console.log(
  "stores that name the holder:",
  attempt(() => ((Map.prototype as any).owner = "every map")),
  attempt(() => ((Array.prototype as any).owner = "every array")),
  attempt(() => ((Error.prototype as any).owner = "every error")),
);
console.log("after:", all(), "|", (new Map() as any).owner, ([] as any).owner, (new Error("e") as any).owner);
const key = JSON.parse('"region"');
const holders: any[] = [registry, stack, failure].map(object => Object.getPrototypeOf(Object.getPrototypeOf(object)));
console.log("stores under a computed key:", holders.map(holder => attempt(() => (holder[key] = "everywhere"))).join(" "));
console.log("after:", all());
registry.owner = "mine";
stack.region = "here";
failure.owner = "mine";
console.log("own ones:", all(), Object.keys(registry).join(), Object.keys(stack).join(), Object.keys(failure).join());
console.log("deletes:", holders.map(holder => attempt(() => { delete holder.owner; delete holder[key]; })).join(" "));
console.log("after:", all());
