// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first position that the constructor records.
// Here: `import.meta` in a CommonJS file, which this one is because it names `module`. It is printed as a name there, and what is mapped right behind that name takes its record. Not so behind `typeof` and `delete`, and not the backquote behind `new`.
function column(A) {
  const given = { __proto__: A.prototype };
  const B = new Proxy(A, { get: (t, k) => (k === "prototype" ? given : t[k]) });
  try {
    new B();
  } catch (error) {
    console.log(error.stack.split("\n").find(line => line.includes("new A")).replace(/.*[\\/]/, ""));
  }
}
module.exports = column;
column(
class A {
  constructor(a) {
    this.t = import.meta
      .url;
  }
}
);
column(
class A {
  constructor(a) {
    import.meta
      [a];
  }
}
);
column(
class A {
  constructor(a) {
    import.meta
      ?.other;
  }
}
);
column(
class A {
  constructor(a) {
    import.meta
      ?.[a];
  }
}
);
column(
class A {
  constructor(a) {
    import.meta
      `x`;
  }
}
);
column(
class A {
  constructor(a) {
    (import.meta
    )(a);
  }
}
);
column(
class A {
  constructor(a) {
    import.meta
      .x = a;
  }
}
);
column(
class A {
  constructor(a) {
    import.meta
      .resolve(a);
  }
}
);
column(
class A {
  constructor(a) {
    const meta = import.meta;
    const dir = meta.dir;
  }
}
);
column(
class A {
  constructor(a) {
    const meta = import.meta;
    const made = meta();
  }
}
);
column(
class A {
  constructor(a) {
    const meta = import.meta;
    const made = meta`x`;
  }
}
);
column(
class A {
  constructor(a) {
    a = [import.meta];
  }
}
);
column(
class A {
  constructor(a) {
    a = [typeof import.meta];
  }
}
);
column(
class A {
  constructor(a) {
    a = typeof import.meta
      .y;
  }
}
);
column(
class A {
  constructor(a) {
    a = [delete import.meta];
  }
}
);
column(
class A {
  constructor(a) {
    new import.meta
      `x`;
  }
}
);
column(
class A {
  constructor(a) {
    new import.meta
      `x`.y;
  }
}
);
column(
class A {
  constructor(a) {
    new import.meta
      `x``y`;
  }
}
);
