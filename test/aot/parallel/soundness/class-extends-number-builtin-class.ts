// A variable holds a number. A branch that is not taken at run time would store a built-in class or a class of the program
// into it. Classes extend the variable, at the top level and in a function, and each definition reports what it throws.
function never(): boolean {
  return Date.now() < 0;
}
class Plain {}

let builtin: any = 7;
if (never()) builtin = Int16Array;
try {
  class Below extends builtin {}
  console.log("defined", new Below().length);
} catch (error) {
  console.log("first:", String(error));
}

let own: any = "text";
if (never()) own = Plain;
try {
  class Below extends own {}
  console.log("defined", new Below() instanceof Plain);
} catch (error) {
  console.log("second:", String(error));
}

function define(): void {
  let local: any = undefined;
  if (never()) local = Plain;
  class Below extends local {}
  console.log("defined", new Below() instanceof Plain);
}
try {
  define();
} catch (error) {
  console.log("third:", String(error));
}

let absent: any = null;
if (never()) absent = Plain;
class Rootless extends absent {}
console.log(
  "fourth:",
  Object.getPrototypeOf(Rootless.prototype),
  Object.getPrototypeOf(Rootless) === Function.prototype,
);
