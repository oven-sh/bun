// Prints where the caller of a function expression stands in the frames of an error that is thrown in it, which is the last token of the function. The function ends in a statement that uses a variable once, and
// Bun's transpiler prints the variable's initializer there. Where that is a literal beside another literal it prints what the operator gives.
function same(value) {
  return value;
}
function fail() {
  throw new Error("fail");
}
function framesOf(error) {
  return error.stack
    .split("\n")
    .slice(1)
    .map(line =>
      line
        .trim()
        .replace(/\(?[^ ()]*[\/\\][\w-]+\.mjs:(\d+:\d+)\)?/, "$1")
        .replace(/^at /, ""),
    )
    .join(" < ");
}
try {
  (function () {
    fail();
    const v = 564;
    return 565 | v;
  })();
} catch (error) {
  console.log("or", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return v | 565;
  })();
} catch (error) {
  console.log("orLeft", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return 565 + v;
  })();
} catch (error) {
  console.log("sum", framesOf(error));
}
try {
  (function () {
    fail();
    const v = "a";
    return "b" + v;
  })();
} catch (error) {
  console.log("texts", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return -v;
  })();
} catch (error) {
  console.log("minus", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return !v;
  })();
} catch (error) {
  console.log("not", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return v ? same(1) : same(2);
  })();
} catch (error) {
  console.log("condition", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return 565 === v;
  })();
} catch (error) {
  console.log("equal", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return same(565 | v);
  })();
} catch (error) {
  console.log("inCall", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return 1 | 565 | v;
  })();
} catch (error) {
  console.log("three", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return v && same(1);
  })();
} catch (error) {
  console.log("and", framesOf(error));
}
try {
  (function () {
    fail();
    let v = 564;
    return 565 * v;
  })();
} catch (error) {
  console.log("declaredWithLet", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return typeof v;
  })();
} catch (error) {
  console.log("typeOf", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return `a${v}`;
  })();
} catch (error) {
  console.log("template", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return 565 < v;
  })();
} catch (error) {
  console.log("less", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    const w = 565 | v;
    return w;
  })();
} catch (error) {
  console.log("twice", framesOf(error));
}
try {
  (function () {
    fail();
    const v = "ab";
    return v.length;
  })();
} catch (error) {
  console.log("length", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 1;
    return [5, 6][v];
  })();
} catch (error) {
  console.log("element", framesOf(error));
}
try {
  (function () {
    fail();
    const a = 1;
    const b = 2;
    return a + b;
  })();
} catch (error) {
  console.log("two", framesOf(error));
}
try {
  (function () {
    fail();
    const a = 1;
    const b = 2;
    return a + b + same(3);
  })();
} catch (error) {
  console.log("twoAndCall", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return same(1) + v;
  })();
} catch (error) {
  console.log("callFirst", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    throw 565 | v;
  })();
} catch (error) {
  console.log("thrown", framesOf(error));
}
try {
  (function () {
    fail();
    const v = null;
    return v ?? same(1);
  })();
} catch (error) {
  console.log("nullish", framesOf(error));
}
try {
  (function () {
    fail();
    const v = same;
    return 565 | v;
  })();
} catch (error) {
  console.log("name", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 1 + 2;
    return 565 | v;
  })();
} catch (error) {
  console.log("computed", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return v;
  })();
} catch (error) {
  console.log("alone", framesOf(error));
}
try {
  (function () {
    const v = 564;
    fail();
    return 565 === v;
  })();
} catch (error) {
  console.log("a constant at the start", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 564;
    return 565 !== v;
  })();
} catch (error) {
  console.log("unequal", framesOf(error));
}
try {
  (function () {
    fail();
    const v = 0;
    return v ? same(1) : same(2) + 1;
  })();
} catch (error) {
  console.log("condition that fails", framesOf(error));
}
