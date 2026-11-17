// A member of an enum under a key that a call passes to a function is read at run time, also where the function has a copy for the call.
enum Kind { First = 1, Second = 2 }
function createReader(key: "First" | "Second") { return class { get() { return Kind[key]; } }; }
const First = createReader("First"), Second = createReader("Second");
(Kind as any).First = "stored";
console.log(new First().get(), new Second().get());
