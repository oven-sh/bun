import React from "react";

const foo = {
  object: {
    nested: `foo1`,
  },
  bar: 1,
  // React: React,
};

const arrays = [1, 2, 3, "10", 200n, React.createElement("foo")];

function hi() {
  console.log("We need to go deeper.");
  function hey() {
    hi();
  }
}

class Foo {
  get prop() {
    return 1;
  }

  set prop(v) {
    this._v = v;
  }

  static staticInstance() {
    return "hi";
  }

  static get prop() {
    return "yo";
  }

  static set prop(v) {
    Foo.v = v;
  }

  insance() {}
  insanceWithArgs(arg, arg2) {}
  insanceWithRestArgs(arg, arg2, ...arg3) {}
}

try {
  console.log("HI");
} catch (e) {
  console.log("HEY", e);
}

if (true) {
  for (let i = 0; i < 100; i++) {
    console.log();
  }
  console.log("development!");
}
