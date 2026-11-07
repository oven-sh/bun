// Prints where an error out of making `this` is reported in a constructor that first calls a tag whose template has text that is not ASCII and a value. Bun's transpiler prints such a template as a call of the tag: what it makes up for the template records before the value, and is looked up at the backquote.
// Todo: the executable reports the value: its compiler keeps the template as it is written, where the values of a tagged template record first
function column(A) {
  const given = { __proto__: A.prototype };
  const B = new Proxy(A, { get: (t, k) => (k === "prototype" ? given : t[k]) });
  try {
    new B();
  } catch (error) {
    console.log(error.stack.split("\n").find(line => line.includes("new A")).replace(/.*[\\/]/, ""));
  }
}
column(
class A {
  constructor(a) {
    this
      `é${a}`;
  }
}
);
