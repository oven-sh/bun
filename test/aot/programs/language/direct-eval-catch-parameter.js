// The parameter of catch (e) has a scope of its own, and the declarations of a sloppy direct eval pass it (ECMA-262 B.3.4).
module.exports = {};

function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}

function declaresWithoutValue() {
  try {
    throw 1;
  } catch (e) {
    eval("var e");
    return e;
  }
}
show("var without a value", declaresWithoutValue);

function declaresInFunction() {
  try {
    throw 1;
  } catch (e) {
    eval("var e = 2");
  }
  return [typeof e, e];
}
show("the variable belongs to the function", declaresInFunction);

function declaresFunction() {
  let inside;
  try {
    throw 1;
  } catch (e) {
    eval("function e() { return 3 }");
    inside = typeof e;
  }
  return [inside, typeof e, e()];
}
show("function declaration", declaresFunction);

function readsAndStores() {
  try {
    throw 1;
  } catch (e) {
    const read = eval("e");
    eval("e += 10");
    return [read, e];
  }
}
show("read and store", readsAndStores);

function deletes() {
  try {
    throw 1;
  } catch (e) {
    return [eval("delete e"), e];
  }
}
show("delete", deletes);

function createAccessors() {
  try {
    throw 1;
  } catch (e) {
    return { set: eval("(function (value) { e = value })"), get: () => e };
  }
}
const accessors = createAccessors();
accessors.set(5);
show("closure stores after return", () => accessors.get());

function nests() {
  try {
    throw 1;
  } catch (e) {
    let inner;
    try {
      throw 2;
    } catch (e) {
      eval("var e = 3");
      inner = e;
    }
    return [inner, e];
  }
}
show("nested catch", nests);

function storesUnderWith() {
  const object = { e: 5 };
  try {
    throw 1;
  } catch (e) {
    with (object) {
      eval("var e = 6");
    }
    return [object.e, e];
  }
}
show("with inside catch", storesUnderWith);

function catchesUnderWith() {
  const object = { e: 5 };
  with (object) {
    try {
      throw 1;
    } catch (e) {
      eval("var e = 6");
      return [object.e, e];
    }
  }
}
show("catch inside with", catchesUnderWith);

function readsOuterNames(parameter) {
  let local = 2;
  try {
    throw 1;
  } catch (e) {
    return eval("local += e; [parameter, local, typeof show, typeof missing]");
  }
}
show("names outside the catch", () => readsOuterNames(7));

function redeclaresBlockLet() {
  try {
    throw 1;
  } catch (e) {
    let x = 1;
    eval("var x = 2");
    return x;
  }
}
show("var over let in the block of the catch", redeclaresBlockLet);

function redeclaresArrayPattern() {
  try {
    throw [1];
  } catch ([e]) {
    eval("var e = 2");
    return e;
  }
}
show("var over a destructured parameter", redeclaresArrayPattern);

function redeclaresInForOf() {
  try {
    throw 1;
  } catch (e) {
    eval("for (var e of [2]);");
    return e;
  }
}
show("for (var e of ..)", redeclaresInForOf);

try {
  throw 1;
} catch (e) {
  console.log("outside any function", eval("e += 1; e"), e);
}
show("nothing on the global object", () => typeof globalThis.e);
