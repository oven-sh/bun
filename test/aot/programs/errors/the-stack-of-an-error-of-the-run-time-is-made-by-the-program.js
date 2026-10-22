// Error.prepareStackTrace is called for an error that the run time makes too: it gets the error, and what it answers is the `stack`.
class Body {
  constructor(mass) {
    this.mass = mass;
  }
  weight() {
    return this.mass * 2;
  }
}
const made = new Body(3);
const handed = [];
Error.prepareStackTrace = function (error, sites) {
  handed.push(error);
  error.mass = 11;
  return made;
};
const nothing = process.argv.length > 99 ? made : undefined;
try {
  nothing.mass;
} catch (error) {
  const stack = error.stack;
  console.log(
    stack === made,
    stack.weight(),
    error.mass,
    handed.length,
    handed[0] === error,
    error instanceof TypeError,
  );
}
