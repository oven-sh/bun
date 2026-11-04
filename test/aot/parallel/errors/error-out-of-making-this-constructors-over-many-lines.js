// Making `this` has no position of its own: an error out of reading the prototype of new.target is reported at the first position that the constructor records.
// Here: constructors that are written over many lines, as the transpiler prints them and otherwise.
function f() {
  return 0;
}
const g = { x: 1, l: [] };
class C2 {}
var p = 1;
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
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
}
);
column(
class A {
  constructor(a, b) {
    // a comment
    this.a = a;
  }
}
);
column(
class A {
  constructor(a, b) {
    /* c */ this.a = /* d */ a;
  }
}
);
column(
class A {
  constructor(
    a,
    b,
  ) {
    this.a = a;
  }
}
);
column(
class A {
  constructor(
    a = p,
    b,
  ) {
    this.a = a;
  }
}
);
column(
class A {
  constructor({
    a,
    b = p,
  }) {
    this.a = a;
  }
}
);
column(
class A {
  constructor(a) {
    this.t = [
      a,
    ];
  }
}
);
column(
class A {
  constructor(a) {
    this.t = [
      a
    ];
  }
}
);
column(
class A {
  constructor(a) {
    this.t = [
      1,
      a,
    ];
  }
}
);
column(
class A {
  constructor(a) {
    this.t = [a,
      1];
  }
}
);
column(
class A {
  constructor(a) {
    this.t = {
      a,
    };
  }
}
);
column(
class A {
  constructor(a) {
    this.t = {
      a
    };
  }
}
);
column(
class A {
  constructor(a, options) {
    this.t = {
      options,
      a,
    };
  }
}
);
column(
class A {
  constructor(a, options) {
    this.t = {
      a,
      options,
    };
  }
}
);
column(
class A {
  constructor(a, options) {
    this.t = {
      options,
    };
    this.u = 1;
  }
}
);
column(
class A {
  constructor(a, optionsWithAVeryLongName) {
    this.t = {
      optionsWithAVeryLongName,
      a,
    };
  }
}
);
column(
class A {
  constructor(a, optionsWithAVeryLongName) {
    this.t = {
      optionsWithAVeryLongName,
    };
    f();
  }
}
);
column(
class A {
  constructor(a) {
    this.t = {
      x: a,
    };
  }
}
);
column(
class A {
  constructor(a) {
    (function () {})(
      a,
    );
  }
}
);
column(
class A {
  constructor(a) {
    (function () {})(
      1,
      a
    );
  }
}
);
column(
class A {
  constructor(a) {
    this
      .m(a);
  }
}
);
column(
class A {
  constructor(a) {
    this
      .x
      .y;
  }
}
);
column(
class A {
  constructor(a) {
    a
      .x
      .y();
  }
}
);
column(
class A {
  constructor(a) {
    this.t =
      a;
  }
}
);
column(
class A {
  constructor(a) {
    this.t =
      1;
    f();
  }
}
);
column(
class A {
  constructor(a) {
    this.t = 1 +
      this;
    f();
  }
}
);
column(
class A {
  constructor(a) {
    this.t = "x" +
      this +
      "y";
    f();
  }
}
);
column(
class A {
  constructor(a) {
    if (
      a
    ) {
      f();
    }
  }
}
);
column(
class A {
  constructor(a) {
    if (this) {
      f();
    }
  }
}
);
column(
class A {
  constructor(a) {
    const {
      x,
      y,
    } = a;
  }
}
);
column(
class A {
  constructor(a) {
    const {
      x,
      ...r
    } = this;
    f();
  }
}
);
column(
class A {
  constructor(a) {
    const [
      x,
    ] = this;
    f();
  }
}
);
column(
class A {
  constructor(a) {
    const c = 1.5,
      [x] = this;
    f();
  }
}
);
column(
class A {
  constructor(a) {
    throw new Error(
      "x",
    );
  }
}
);
column(
class A {
  constructor(a) {
    throw {
      x: 1,
    };
  }
}
);
column(
class A {
  constructor(a) {
    throw [
      1,
    ];
  }
}
);
column(
class A {
  constructor(a) {
    return {
      a,
    };
  }
}
);
column(
class A {
  constructor(a) {
    (function () {
      f();
    })();
  }
}
);
column(
class A {
  constructor(a) {
    (() => {
      f();
    })();
  }
}
);
column(
class A {
  constructor(a) {
    new (class {
      m() {}
    })();
  }
}
);
column(
class A {
  constructor(a) {
    class Z {
      m() {}
    }
    f();
  }
}
);
column(
class A {
  constructor(a) {
    class LongName {}
    this.h = () => LongName;
  }
}
);
column(
class A {
  constructor(a) {
    class Sixsix {}
    this.h = () => Sixsix;
  }
}
);
column(
class A {
  constructor(a) {
    class Fives {}
    this.h = () => Fives;
  }
}
);
column(
class A {
  constructor(a) {
    class LongName { m() { return LongName; } }
    f();
  }
}
);
column(
class A {
  constructor(a) {
    switch (this) {
      case 1:
        f();
    }
  }
}
);
column(
class A {
  constructor(a) {
    for (
      const x of this
    ) {
      f();
    }
  }
}
);
column(
class A {
  constructor(a) {
    try {
      this.x = 1;
    } catch {
      f();
    }
  }
}
);
column(
class A {
  constructor(a) {


    this.a = a;
  }
}
);
column(
class A {
	constructor(a) {
		this.a = a;
	}
}
);
column(
class A
{
  constructor(a)
  {
    this.a = a;
  }
}
);
column(
class A {
  constructor(a) {
    this.t = [a];
  }
}
);
column(
(() => {
  return class A {
    constructor(a, options) {
      this.t = { options };
      this.u = 1;
    }
  };
})()
);
column(
(() => {
  class A {
    constructor(a) {
      this.a = a;
    }
  }
  return A;
})()
);
column(
{ A: class A {
  constructor(a) {
    this.a = a;
  }
} }.A
);
