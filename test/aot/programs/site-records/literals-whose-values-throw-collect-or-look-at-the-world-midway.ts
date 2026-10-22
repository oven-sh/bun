// The values of a literal are evaluated in order, each with effects: one throws, one runs a collection, one makes the same literal again, one awaits or yields. What was evaluated stays evaluated, nothing half made is ever seen, and every value survives.
const trail: string[] = [];

interface Triple {
  first: unknown;
  second: unknown;
  third: unknown;
}

function attempt(run: () => unknown): string {
  try {
    return JSON.stringify(run()) + " after " + trail.splice(0).join();
  } catch (error) {
    return "throws " + (error as Error).constructor.name + " after " + trail.splice(0).join();
  }
}
function noted<T>(value: T, name: string): T {
  trail.push(name);
  return value;
}
function failing(name: string): never {
  trail.push(name);
  throw new RangeError(name);
}
function fresh(text: string): { text: string; list: number[] } {
  return { text: text + "!", list: [text.length, 0.5] };
}
function collecting<T>(value: T): T {
  Bun.gc(true);
  return value;
}

function ordered(): Triple {
  return { first: noted(1, "first"), second: noted(2, "second"), third: noted(3, "third") };
}
function throwsFirst(): Triple {
  return { first: failing("first"), second: noted(2, "second"), third: noted(3, "third") };
}
function throwsBetween(): Triple {
  return { first: noted(1, "first"), second: failing("second"), third: noted(3, "third") };
}
function throwsLast(): Triple {
  return { first: noted(1, "first"), second: noted(2, "second"), third: failing("third") };
}
function collectsBetween(): Triple {
  return { first: fresh("first"), second: collecting(fresh("second")), third: fresh("third") };
}
function collectsEverywhere(): Triple {
  return { first: collecting(fresh("first")), second: collecting([fresh("second"), collecting(fresh("inner"))]), third: collecting("third".repeat(2)) };
}
function recursive(depth: number): Triple {
  return { first: depth, second: depth > 0 ? recursive(depth - 1) : null, third: depth > 1 ? recursive(depth - 2) : collecting("leaf") };
}
function nestedThrow(): unknown {
  return { outer: noted(1, "outer"), inner: { first: noted(2, "inner first"), list: [noted(3, "element"), failing("second element"), noted(4, "never")] }, after: noted(5, "never") };
}
function assignsWhileBuilding(): unknown {
  let counter = 0;
  return { first: counter++, second: counter++, third: (counter += 10), fourth: counter };
}
async function awaitsBetween(): Promise<Triple> {
  return { first: fresh("first"), second: await Promise.resolve(fresh("second")), third: collecting(await fresh("third")) };
}
function* yieldsBetween(): Generator<string, Triple, unknown> {
  return { first: fresh("first"), second: yield "wants second", third: yield "wants third" };
}

console.log("ordered:", attempt(ordered));
console.log("throws first:", attempt(throwsFirst));
console.log("throws between:", attempt(throwsBetween));
console.log("throws last:", attempt(throwsLast));
console.log("ordered:", attempt(ordered));
console.log("collects between:", attempt(collectsBetween));
console.log("collects everywhere:", attempt(collectsEverywhere));
console.log("recursive:", attempt(() => recursive(4)));
console.log("nested throw:", attempt(nestedThrow));
console.log("assigns:", attempt(assignsWhileBuilding));
console.log("awaits:", JSON.stringify(await awaitsBetween()));
const steps = yieldsBetween();
console.log("yields:", JSON.stringify(steps.next()), collecting(JSON.stringify(steps.next(fresh("sent second")))), JSON.stringify(steps.next(collecting(fresh("sent third")))));
const abandoned = yieldsBetween();
console.log("abandoned:", JSON.stringify(abandoned.next()), JSON.stringify(abandoned.return({ first: 0, second: 0, third: 0 })), JSON.stringify(abandoned.next()));

export {};
