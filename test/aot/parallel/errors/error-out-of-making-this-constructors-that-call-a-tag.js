// Prints where an error out of making `this` is reported in constructors that first call a tag: at the first position that the constructor records. Bun's transpiler prints a tagged template whose text is not ASCII as a call of the tag, and what that call records is looked up as behind the template where the text is ASCII.
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
      `é`;
  }
}
);
column(
class A {
  constructor(a) {
    (function () {
      return a;
    })
      `é`;
  }
}
);
column(
class A {
  constructor(a) {
    a
      `é`;
  }
}
);
column(
class A {
  constructor(a) {
    this
      `e`;
  }
}
);
column(
class A {
  constructor(a) {
    (function () {
      return a;
    })
      `e`;
  }
}
);
column(
class A {
  constructor(a) {
    a
      `e`;
  }
}
);
column(
class A {
  constructor(a) {
    this
      `e${a}`;
  }
}
);
