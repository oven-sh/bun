// Two variables declared as an object type hold undefined. The first would take a class, but that class reads its own name
// as a computed key, so the store never runs. A second class extends the first variable, and the second variable is constructed.
function pass<T>(value: T): T;
function pass(value: unknown): unknown {
  return value;
}
interface Shape {}

let parent: Shape = pass<Shape>(undefined as any);
try {
  const first: any = class extends (Int16Array as any) {
    // @ts-ignore
    [first];
  };
  parent = first as any;
} catch (error) {
  console.log("first:", String(error));
}

let child: Shape = pass<Shape>(undefined as any);
try {
  class Second extends (parent as any) {}
  child = Second as any;
} catch (error) {
  console.log("second:", String(error));
}

try {
  // @ts-ignore
  new child();
  console.log("constructed");
} catch (error) {
  console.log("third:", String(error));
}
console.log(typeof parent, typeof child);
