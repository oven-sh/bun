const unseen = (0, eval)("(x) => x");
class Child extends Object { constructor(x) { super(x, 1); } }
class Kid extends Object {}
Object.setPrototypeOf(Child, unseen({}));
Object.setPrototypeOf(Kid, unseen({}));
for (const limit of [10, 0, 1, "x", undefined, 10]) {
  Error.stackTraceLimit = limit;
  for (const made of [Child, Kid]) {
    try { new made(1); } catch (error) { console.log(String(limit), JSON.stringify(error.message)); }
  }
}
