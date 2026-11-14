// Array.from with a function over lists that it changes, iterators of lists and everything else.
const lines = [];
let calls = 0;
function log(t) {
  lines.push(t);
}

class Sub extends Array {
  tag() {
    return "sub";
  }
}

class SubIter extends Array {
  *[Symbol.iterator]() {
    yield "i";
  }
}

class Own {
  n;
  constructor(n) {
    this.n = n;
  }
}

class Fixed extends Array {
  constructor() {
    super();
    Object.defineProperty(this, 1, { value: "fix", writable: !1, configurable: !1 });
  }
}
Own.from = Array.from;
const box = { k: 3, get(x) {
  return this ? this.k + ":" + show(x) : "none:" + show(x);
} };
function named(x, k) {
  return k + "=" + show(x);
}
function* gen() {
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    log("closed");
  }
}
function iterable() {
  let k = 0;
  return { [Symbol.iterator]() {
    return { next() {
      return { done: k >= 4, value: k++ };
    }, return() {
      log("return");
      return {};
    } };
  } };
}
function show(x) {
  if (typeof x === "number")
    return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "string")
    return JSON.stringify(x);
  if (Array.isArray(x)) {
    let t = "[";
    for (let k = 0;k < Math.min(x.length, 12); k++)
      t += (k in x ? show(x[k]) : "_") + ",";
    return t + "]" + x.length + (x.constructor !== Array ? x.constructor?.name : "");
  }
  if (x instanceof Promise)
    return "promise";
  if (x && typeof x === "object") {
    if (x instanceof Own)
      return "Own" + show(x.n) + Object.keys(x).join();
    return "{" + Object.keys(x).slice(0, 4).map((k) => k + ":" + show(x[k])).join() + "}";
  }
  if (typeof x === "function")
    return "f";
  return String(x);
}
function keep(x) {
  return x;
}
let total = 0;
let digest = 0;
function run(name, f) {
  lines.length = 0;
  calls = 0;
  let a;
  try {
    a = show(f());
  } catch (e) {
    a = "!" + (e && e.constructor && e.constructor.name) + ":" + (e && e.message);
  }
  const t = name + " " + a + " " + lines.join("|") + " " + calls;
  console.log(t.slice(0, 300));
  total++;
}
run("ints_none_no_A", () => {
  let s = keep([5, 3, 8, 1]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s);
  return r;
});
run("ints_named_no_A", () => {
  let s = keep([5, 3, 8, 1]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, named);
  return r;
});
run("ints_func_prim_A", () => {
  let s = keep([5, 3, 8, 1]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    }, 5);
  return r;
});
function f7_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("ints_throws_no_A", () => f7_no_A([5, 3, 8, 1]));
run("ints_grow_no_A", () => {
  let s = keep([5, 3, 8, 1]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("ints_shrink_obj_A", () => {
  let s = keep([5, 3, 8, 1]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    }, { v: 4 });
  return r;
});
run("ints_shrink_no_A", () => {
  let s = keep([5, 3, 8, 1]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
function f10_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("ints_turn_no_A", () => f10_no_A([5, 3, 8, 1]));
run("ints_holed_no_A", () => {
  let s = keep([5, 3, 8, 1]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("ints_klass_no_A", () => {
  let s = keep([5, 3, 8, 1]);
  const r = Array.from(s, class Z {
  });
  return [r, s];
});
run("ints_asyncs_obj_Plain", () => {
  let s = keep([5, 3, 8, 1]);
  const r = { from: Array.from }.from(s, async (x) => x, { v: 4 });
  return [r, s];
});
function f19_no_A(s) {
  return Array.from(s, (x, k) => ({ k, x }));
}
run("ints_objs_no_A", () => f19_no_A([5, 3, 8, 1]));
run("doubles_first_undef_A", () => {
  let s = keep([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]);
  const r = Array.from(s, (x) => x, void 0);
  return [r, s];
});
run("doubles_bound_prim_A", () => {
  let s = keep([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]);
  const r = Array.from(s, box.get.bind(box), 5);
  return [r, s];
});
function f28_no_Fixed(s) {
  return Fixed.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("doubles_throws_no_Fixed", () => f28_no_Fixed([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]));
function f28_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("doubles_throws_no_A", () => f28_no_A([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]));
run("doubles_grow_no_A", () => {
  let s = keep([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("doubles_shrink_no_A", () => {
  let s = keep([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
function f31_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("doubles_turn_no_A", () => f31_no_A([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]));
run("doubles_holed_no_A", () => {
  let s = keep([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
function f34_prim_A(s) {
  return Array.from(s, 5, 5);
}
run("doubles_notfn_prim_A", () => f34_prim_A([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]));
run("doubles_native_no_A", () => {
  let s = keep([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs);
  return r;
});
run("doubles_count_undef_Own", () => {
  let s = keep([1.5, NaN, -0, 2.25, 1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, () => ++calls, void 0);
  return r;
});
run("texts_none_no_A", () => {
  let s = keep(["a", "bc", "", "d"]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s);
  return r;
});
run("texts_named_no_Own", () => {
  let s = keep(["a", "bc", "", "d"]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, named);
  return r;
});
run("texts_bound_undef_A", () => {
  let s = keep(["a", "bc", "", "d"]);
  const r = Array.from(s, box.get.bind(box), void 0);
  return [r, s];
});
run("texts_holed_obj_A", () => {
  let s = keep(["a", "bc", "", "d"]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  }, { v: 4 });
  return [r, s];
});
run("texts_klass_no_Sub", () => {
  let s = keep(["a", "bc", "", "d"]);
  const r = Sub.from(s, class Z {
  });
  return [r, s];
});
function f58_prim_A(s) {
  return Array.from(s, parseInt, 5);
}
run("texts_parse_prim_A", () => f58_prim_A(["a", "bc", "", "d"]));
run("texts_set_prim_Sub", () => {
  let s = keep(["a", "bc", "", "d"]);
  const r = Sub.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  }, 5);
  return [r, s];
});
function f64_no_A(s) {
  return Array.from(s, (x, k) => show(x) + k);
}
run("mixed_arrow_no_A", () => f64_no_A([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]));
function f67_undef_A(s) {
  return Array.from(s, box.get, void 0);
}
run("mixed_method_undef_A", () => f67_undef_A([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]));
run("mixed_func_no_A", () => {
  let s = keep([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    });
  return r;
});
function f70_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("mixed_throws_no_A", () => f70_no_A([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]));
run("mixed_grow_no_A", () => {
  let s = keep([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("mixed_shrink_no_A", () => {
  let s = keep([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
function f73_obj_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  }, { v: 4 });
}
run("mixed_turn_obj_A", () => f73_obj_A([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]));
function f73_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("mixed_turn_no_A", () => f73_no_A([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]));
run("mixed_holed_no_A", () => {
  let s = keep([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("mixed_kinds_undef_A", () => {
  let s = keep([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6], void 0);
  return r;
});
run("mixed_klass_no_Plain", () => {
  let s = keep([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]);
  const r = { from: Array.from }.from(s, class Z {
  });
  return [r, s];
});
run("mixed_set_undef_A", () => {
  let s = keep([1, "x", null, void 0, { v: 3 }, [4], !0, 2.5]);
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  }, void 0);
  return [r, s];
});
run("empty_first_prim_A", () => {
  let s = keep([]);
  const r = Array.from(s, (x) => x, 5);
  return [r, s];
});
function f88_no_Fixed(s) {
  return Fixed.from(s, box.get);
}
run("empty_method_no_Fixed", () => f88_no_Fixed([]));
run("empty_grow_no_Sub", () => {
  let s = keep([]);
  const r = Sub.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
function f94_prim_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  }, 5);
}
run("empty_turn_prim_A", () => f94_prim_A([]));
run("empty_kinds_no_A", () => {
  let s = keep([]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6]);
  return r;
});
run("empty_count_prim_A", () => {
  let s = keep([]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls, 5);
  return r;
});
run("one_none_no_A", () => {
  let s = keep([7]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s);
  return r;
});
run("one_first_no_Plain", () => {
  let s = keep([7]);
  const r = { from: Array.from }.from(s, (x) => x);
  return [r, s];
});
run("one_func_undef_A", () => {
  let s = keep([7]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    }, void 0);
  return r;
});
run("one_grow_no_Plain", () => {
  let s = keep([7]);
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("one_holed_no_A", () => {
  let s = keep([7]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
function f118_no_Fixed(s) {
  return Fixed.from(s, 5);
}
run("one_notfn_no_Fixed", () => f118_no_Fixed([7]));
run("one_asyncs_prim_A", () => {
  let s = keep([7]);
  const r = Array.from(s, async (x) => x, 5);
  return [r, s];
});
function f124_no_Fixed(s) {
  return Fixed.from(s, (x, k) => ({ k, x }));
}
run("one_objs_no_Fixed", () => f124_no_Fixed([7]));
function f127_undef_A(s) {
  return Array.from(s, (x, k) => show(x) + k, void 0);
}
run("holes_arrow_undef_A", () => f127_undef_A([1, , 3, ,]));
function f133_obj_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  }, { v: 4 });
}
run("holes_throws_obj_A", () => f133_obj_A([1, , 3, ,]));
function f133_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("holes_throws_no_A", () => f133_no_A([1, , 3, ,]));
run("holes_grow_no_A", () => {
  let s = keep([1, , 3, ,]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("holes_shrink_undef_A", () => {
  let s = keep([1, , 3, ,]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    }, void 0);
  return r;
});
run("holes_shrink_no_A", () => {
  let s = keep([1, , 3, ,]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
function f136_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("holes_turn_no_A", () => f136_no_A([1, , 3, ,]));
run("holes_holed_no_Plain", () => {
  let s = keep([1, , 3, ,]);
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("holes_holed_no_A", () => {
  let s = keep([1, , 3, ,]);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("holes_native_no_Own", () => {
  let s = keep([1, , 3, ,]);
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, Math.abs);
  return r;
});
run("holes_asyncs_undef_A", () => {
  let s = keep([1, , 3, ,]);
  const r = Array.from(s, async (x) => x, void 0);
  return [r, s];
});
run("holes_set_prim_A", () => {
  let s = keep([1, , 3, ,]);
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  }, 5);
  return [r, s];
});
run("sparse_func_obj_Own", () => {
  let s = keep((() => {
    const a = [1];
    a[40] = 5;
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    }, { v: 4 });
  return r;
});
function f154_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("sparse_throws_no_A", () => f154_no_A((() => {
  const a = [1];
  a[40] = 5;
  return a;
})()));
function f157_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("sparse_turn_no_A", () => f157_no_A((() => {
  const a = [1];
  a[40] = 5;
  return a;
})()));
function f160_no_A(s) {
  return Array.from(s, 5);
}
run("sparse_notfn_no_A", () => f160_no_A((() => {
  const a = [1];
  a[40] = 5;
  return a;
})()));
function f163_undef_A(s) {
  return Array.from(s, parseInt, void 0);
}
run("sparse_parse_undef_A", () => f163_undef_A((() => {
  const a = [1];
  a[40] = 5;
  return a;
})()));
run("sparse_count_no_A", () => {
  let s = keep((() => {
    const a = [1];
    a[40] = 5;
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls);
  return r;
});
run("big_named_undef_A", () => {
  let s = keep(Array.from({ length: 300 }, (_, k) => k * 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, named, void 0);
  return r;
});
run("big_bound_no_Plain", () => {
  let s = keep(Array.from({ length: 300 }, (_, k) => k * 3));
  const r = { from: Array.from }.from(s, box.get.bind(box));
  return [r, s];
});
run("big_grow_no_A", () => {
  let s = keep(Array.from({ length: 300 }, (_, k) => k * 3));
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("big_klass_prim_A", () => {
  let s = keep(Array.from({ length: 300 }, (_, k) => k * 3));
  const r = Array.from(s, class Z {
  }, 5);
  return [r, s];
});
function f184_no_Fixed(s) {
  return Fixed.from(s, parseInt);
}
run("big_parse_no_Fixed", () => f184_no_Fixed(Array.from({ length: 300 }, (_, k) => k * 3)));
run("big_count_no_A", () => {
  let s = keep(Array.from({ length: 300 }, (_, k) => k * 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls);
  return r;
});
function f190_no_A(s) {
  return Array.from(s, (x, k) => show(x) + k);
}
run("frozen_arrow_no_A", () => f190_no_A(Object.freeze([1, 2, 3])));
function f193_no_A(s) {
  return Array.from(s, box.get);
}
run("frozen_method_no_A", () => f193_no_A(Object.freeze([1, 2, 3])));
run("frozen_func_no_Own", () => {
  let s = keep(Object.freeze([1, 2, 3]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    });
  return r;
});
run("frozen_kinds_no_A", () => {
  let s = keep(Object.freeze([1, 2, 3]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6]);
  return r;
});
run("frozen_klass_no_Plain", () => {
  let s = keep(Object.freeze([1, 2, 3]));
  const r = { from: Array.from }.from(s, class Z {
  });
  return [r, s];
});
run("frozen_asyncs_no_Sub", () => {
  let s = keep(Object.freeze([1, 2, 3]));
  const r = Sub.from(s, async (x) => x);
  return [r, s];
});
run("frozen_set_no_Plain", () => {
  let s = keep(Object.freeze([1, 2, 3]));
  const r = { from: Array.from }.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  });
  return [r, s];
});
run("sealed_named_obj_Own", () => {
  let s = keep(Object.seal([4, 5]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, named, { v: 4 });
  return r;
});
function f214_no_A(s) {
  return Array.from(s, box.get);
}
run("sealed_method_no_A", () => f214_no_A(Object.seal([4, 5])));
function f220_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("sealed_turn_no_A", () => f220_no_A(Object.seal([4, 5])));
function f223_undef_A(s) {
  return Array.from(s, 5, void 0);
}
run("sealed_notfn_undef_A", () => f223_undef_A(Object.seal([4, 5])));
run("sealed_native_no_A", () => {
  let s = keep(Object.seal([4, 5]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs);
  return r;
});
function f229_obj_A(s) {
  return Array.from(s, (x, k) => ({ k, x }), { v: 4 });
}
run("sealed_objs_obj_A", () => f229_obj_A(Object.seal([4, 5])));
run("hole0_none_no_A", () => {
  let s = keep(Array(4));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s);
  return r;
});
run("hole0_named_prim_A", () => {
  let s = keep(Array(4));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, named, 5);
  return r;
});
run("hole0_func_obj_A", () => {
  let s = keep(Array(4));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    }, { v: 4 });
  return r;
});
run("hole0_grow_no_A", () => {
  let s = keep(Array(4));
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("hole0_holed_no_A", () => {
  let s = keep(Array(4));
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("hole0_klass_obj_Plain", () => {
  let s = keep(Array(4));
  const r = { from: Array.from }.from(s, class Z {
  }, { v: 4 });
  return [r, s];
});
function f250_no_A(s) {
  return Array.from(s, (x, k) => ({ k, x }));
}
run("hole0_objs_no_A", () => f250_no_A(Array(4)));
function f253_no_A(s) {
  return Array.from(s, (x, k) => show(x) + k);
}
run("proto_arrow_no_A", () => f253_no_A(Object.setPrototypeOf([1, , 3], { 1: "up", [Symbol.iterator]: Array.prototype[Symbol.iterator] })));
run("proto_named_no_Own", () => {
  let s = keep(Object.setPrototypeOf([1, , 3], { 1: "up", [Symbol.iterator]: Array.prototype[Symbol.iterator] }));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, named);
  return r;
});
function f259_undef_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  }, void 0);
}
run("proto_throws_undef_A", () => f259_undef_A(Object.setPrototypeOf([1, , 3], { 1: "up", [Symbol.iterator]: Array.prototype[Symbol.iterator] })));
run("proto_shrink_no_A", () => {
  let s = keep(Object.setPrototypeOf([1, , 3], { 1: "up", [Symbol.iterator]: Array.prototype[Symbol.iterator] }));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
run("proto_holed_no_Plain", () => {
  let s = keep(Object.setPrototypeOf([1, , 3], { 1: "up", [Symbol.iterator]: Array.prototype[Symbol.iterator] }));
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("proto_asyncs_no_Plain", () => {
  let s = keep(Object.setPrototypeOf([1, , 3], { 1: "up", [Symbol.iterator]: Array.prototype[Symbol.iterator] }));
  const r = { from: Array.from }.from(s, async (x) => x);
  return [r, s];
});
run("proto_set_no_A", () => {
  let s = keep(Object.setPrototypeOf([1, , 3], { 1: "up", [Symbol.iterator]: Array.prototype[Symbol.iterator] }));
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  });
  return [r, s];
});
run("nullproto_first_undef_Plain", () => {
  let s = keep(Object.setPrototypeOf([1, 2], null));
  const r = { from: Array.from }.from(s, (x) => x, void 0);
  return [r, s];
});
run("nullproto_bound_no_A", () => {
  let s = keep(Object.setPrototypeOf([1, 2], null));
  const r = Array.from(s, box.get.bind(box));
  return [r, s];
});
run("nullproto_grow_obj_Plain", () => {
  let s = keep(Object.setPrototypeOf([1, 2], null));
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  }, { v: 4 });
  return [r, s];
});
function f283_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("nullproto_turn_no_A", () => f283_no_A(Object.setPrototypeOf([1, 2], null)));
function f289_no_A(s) {
  return Array.from(s, parseInt);
}
run("nullproto_parse_no_A", () => f289_no_A(Object.setPrototypeOf([1, 2], null)));
run("nullproto_count_no_Own", () => {
  let s = keep(Object.setPrototypeOf([1, 2], null));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, () => ++calls);
  return r;
});
run("nullproto_set_no_A", () => {
  let s = keep(Object.setPrototypeOf([1, 2], null));
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  });
  return [r, s];
});
run("sub_bound_no_A", () => {
  let s = keep(new Sub(1, 2, 3));
  const r = Array.from(s, box.get.bind(box));
  return [r, s];
});
run("sub_grow_no_A", () => {
  let s = keep(new Sub(1, 2, 3));
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("sub_holed_obj_Plain", () => {
  let s = keep(new Sub(1, 2, 3));
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  }, { v: 4 });
  return [r, s];
});
run("sub_native_obj_Own", () => {
  let s = keep(new Sub(1, 2, 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, Math.abs, { v: 4 });
  return r;
});
function f310_no_A(s) {
  return Array.from(s, parseInt);
}
run("sub_parse_no_A", () => f310_no_A(new Sub(1, 2, 3)));
function f313_no_A(s) {
  return Array.from(s, (x, k) => ({ k, x }));
}
run("sub_objs_no_A", () => f313_no_A(new Sub(1, 2, 3)));
run("subiter_bound_no_Sub", () => {
  let s = keep(new SubIter(1, 2, 3));
  const r = Sub.from(s, box.get.bind(box));
  return [r, s];
});
function f322_prim_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  }, 5);
}
run("subiter_throws_prim_A", () => f322_prim_A(new SubIter(1, 2, 3)));
run("subiter_shrink_no_A", () => {
  let s = keep(new SubIter(1, 2, 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
run("subiter_kinds_no_A", () => {
  let s = keep(new SubIter(1, 2, 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6]);
  return r;
});
run("subiter_native_prim_A", () => {
  let s = keep(new SubIter(1, 2, 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs, 5);
  return r;
});
run("subiter_count_obj_A", () => {
  let s = keep(new SubIter(1, 2, 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls, { v: 4 });
  return r;
});
run("owniter_first_no_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = function* () {
      yield 9;
      yield 8;
    };
    return a;
  })());
  const r = Array.from(s, (x) => x);
  return [r, s];
});
run("owniter_bound_obj_Plain", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = function* () {
      yield 9;
      yield 8;
    };
    return a;
  })());
  const r = { from: Array.from }.from(s, box.get.bind(box), { v: 4 });
  return [r, s];
});
function f343_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("owniter_throws_no_A", () => f343_no_A((() => {
  const a = [1, 2, 3];
  a[Symbol.iterator] = function* () {
    yield 9;
    yield 8;
  };
  return a;
})()));
function f346_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("owniter_turn_no_A", () => f346_no_A((() => {
  const a = [1, 2, 3];
  a[Symbol.iterator] = function* () {
    yield 9;
    yield 8;
  };
  return a;
})()));
function f349_no_A(s) {
  return Array.from(s, 5);
}
run("owniter_notfn_no_A", () => f349_no_A((() => {
  const a = [1, 2, 3];
  a[Symbol.iterator] = function* () {
    yield 9;
    yield 8;
  };
  return a;
})()));
run("owniter_native_no_Own", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = function* () {
      yield 9;
      yield 8;
    };
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, Math.abs);
  return r;
});
run("owniter_asyncs_no_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = function* () {
      yield 9;
      yield 8;
    };
    return a;
  })());
  const r = Array.from(s, async (x) => x);
  return [r, s];
});
function f358_prim_A(s) {
  return Array.from(s, (x, k) => show(x) + k, 5);
}
run("ownval_arrow_prim_A", () => f358_prim_A((() => {
  const a = [1, 2, 3];
  a[Symbol.iterator] = a.values;
  return a;
})()));
run("ownval_named_no_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = a.values;
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, named);
  return r;
});
run("ownval_func_undef_Own", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = a.values;
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    }, void 0);
  return r;
});
run("ownval_kinds_obj_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = a.values;
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6], { v: 4 });
  return r;
});
run("ownval_klass_undef_Plain", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = a.values;
    return a;
  })());
  const r = { from: Array.from }.from(s, class Z {
  }, void 0);
  return [r, s];
});
run("ownval_asyncs_prim_Sub", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = a.values;
    return a;
  })());
  const r = Sub.from(s, async (x) => x, 5);
  return [r, s];
});
run("ownval_set_obj_Plain", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    a[Symbol.iterator] = a.values;
    return a;
  })());
  const r = { from: Array.from }.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  }, { v: 4 });
  return [r, s];
});
run("getter_first_no_Sub", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    Object.defineProperty(a, 1, { get() {
      log("get");
      return "g";
    }, configurable: !0, enumerable: !0 });
    return a;
  })());
  const r = Sub.from(s, (x) => x);
  return [r, s];
});
function f382_prim_A(s) {
  return Array.from(s, box.get, 5);
}
run("getter_method_prim_A", () => f382_prim_A((() => {
  const a = [1, 2, 3];
  Object.defineProperty(a, 1, { get() {
    log("get");
    return "g";
  }, configurable: !0, enumerable: !0 });
  return a;
})()));
run("getter_shrink_no_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    Object.defineProperty(a, 1, { get() {
      log("get");
      return "g";
    }, configurable: !0, enumerable: !0 });
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
run("getter_kinds_prim_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    Object.defineProperty(a, 1, { get() {
      log("get");
      return "g";
    }, configurable: !0, enumerable: !0 });
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6], 5);
  return r;
});
run("getter_native_obj_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    Object.defineProperty(a, 1, { get() {
      log("get");
      return "g";
    }, configurable: !0, enumerable: !0 });
    return a;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs, { v: 4 });
  return r;
});
run("getter_asyncs_no_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    Object.defineProperty(a, 1, { get() {
      log("get");
      return "g";
    }, configurable: !0, enumerable: !0 });
    return a;
  })());
  const r = Array.from(s, async (x) => x);
  return [r, s];
});
run("getter_set_no_A", () => {
  let s = keep((() => {
    const a = [1, 2, 3];
    Object.defineProperty(a, 1, { get() {
      log("get");
      return "g";
    }, configurable: !0, enumerable: !0 });
    return a;
  })());
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  });
  return [r, s];
});
run("keys_first_no_Plain", () => {
  let s = keep([1, 2, 3].keys());
  const r = { from: Array.from }.from(s, (x) => x);
  return [r, s];
});
run("keys_bound_no_A", () => {
  let s = keep([1, 2, 3].keys());
  const r = Array.from(s, box.get.bind(box));
  return [r, s];
});
run("keys_grow_undef_A", () => {
  let s = keep([1, 2, 3].keys());
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  }, void 0);
  return [r, s];
});
run("keys_holed_prim_A", () => {
  let s = keep([1, 2, 3].keys());
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  }, 5);
  return [r, s];
});
function f412_no_Fixed(s) {
  return Fixed.from(s, 5);
}
run("keys_notfn_no_Fixed", () => f412_no_Fixed([1, 2, 3].keys()));
function f418_prim_A(s) {
  return Array.from(s, (x, k) => ({ k, x }), 5);
}
run("keys_objs_prim_A", () => f418_prim_A([1, 2, 3].keys()));
run("entries_none_no_A", () => {
  let s = keep(["a", "b"].entries());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s);
  return r;
});
run("entries_named_undef_Own", () => {
  let s = keep(["a", "b"].entries());
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, named, void 0);
  return r;
});
run("entries_func_prim_A", () => {
  let s = keep(["a", "b"].entries());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    }, 5);
  return r;
});
run("entries_shrink_obj_A", () => {
  let s = keep(["a", "b"].entries());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    }, { v: 4 });
  return r;
});
run("entries_holed_undef_Plain", () => {
  let s = keep(["a", "b"].entries());
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  }, void 0);
  return [r, s];
});
run("entries_asyncs_obj_Plain", () => {
  let s = keep(["a", "b"].entries());
  const r = { from: Array.from }.from(s, async (x) => x, { v: 4 });
  return [r, s];
});
function f439_no_A(s) {
  return Array.from(s, (x, k) => ({ k, x }));
}
run("entries_objs_no_A", () => f439_no_A(["a", "b"].entries()));
function f442_no_Fixed(s) {
  return Fixed.from(s, (x, k) => show(x) + k);
}
run("values_arrow_no_Fixed", () => f442_no_Fixed([1, 2, 3].values()));
run("values_bound_prim_A", () => {
  let s = keep([1, 2, 3].values());
  const r = Array.from(s, box.get.bind(box), 5);
  return [r, s];
});
function f448_no_Fixed(s) {
  return Fixed.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("values_throws_no_Fixed", () => f448_no_Fixed([1, 2, 3].values()));
run("values_shrink_no_A", () => {
  let s = keep([1, 2, 3].values());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
run("values_native_no_A", () => {
  let s = keep([1, 2, 3].values());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs);
  return r;
});
run("values_count_undef_Own", () => {
  let s = keep([1, 2, 3].values());
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, () => ++calls, void 0);
  return r;
});
run("values_set_obj_A", () => {
  let s = keep([1, 2, 3].values());
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  }, { v: 4 });
  return [r, s];
});
run("started_named_no_Own", () => {
  let s = keep((() => {
    const i = [1, 2, 3, 4].values();
    i.next();
    return i;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, named);
  return r;
});
run("started_bound_undef_A", () => {
  let s = keep((() => {
    const i = [1, 2, 3, 4].values();
    i.next();
    return i;
  })());
  const r = Array.from(s, box.get.bind(box), void 0);
  return [r, s];
});
run("started_grow_prim_A", () => {
  let s = keep((() => {
    const i = [1, 2, 3, 4].values();
    i.next();
    return i;
  })());
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  }, 5);
  return [r, s];
});
function f472_no_Fixed(s) {
  return Fixed.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("started_turn_no_Fixed", () => f472_no_Fixed((() => {
  const i = [1, 2, 3, 4].values();
  i.next();
  return i;
})()));
run("started_klass_no_Sub", () => {
  let s = keep((() => {
    const i = [1, 2, 3, 4].values();
    i.next();
    return i;
  })());
  const r = Sub.from(s, class Z {
  });
  return [r, s];
});
function f478_prim_A(s) {
  return Array.from(s, parseInt, 5);
}
run("started_parse_prim_A", () => f478_prim_A((() => {
  const i = [1, 2, 3, 4].values();
  i.next();
  return i;
})()));
run("started_count_no_A", () => {
  let s = keep((() => {
    const i = [1, 2, 3, 4].values();
    i.next();
    return i;
  })());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls);
  return r;
});
function f487_undef_A(s) {
  return Array.from(s, box.get, void 0);
}
run("bytes_method_undef_A", () => f487_undef_A(new Uint8Array([1, 2, 250])));
run("bytes_func_no_A", () => {
  let s = keep(new Uint8Array([1, 2, 250]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    });
  return r;
});
run("bytes_grow_no_Plain", () => {
  let s = keep(new Uint8Array([1, 2, 250]));
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("bytes_kinds_undef_A", () => {
  let s = keep(new Uint8Array([1, 2, 250]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6], void 0);
  return r;
});
run("bytes_klass_no_Plain", () => {
  let s = keep(new Uint8Array([1, 2, 250]));
  const r = { from: Array.from }.from(s, class Z {
  });
  return [r, s];
});
run("bytes_asyncs_no_A", () => {
  let s = keep(new Uint8Array([1, 2, 250]));
  const r = Array.from(s, async (x) => x);
  return [r, s];
});
run("floats_first_prim_A", () => {
  let s = keep(new Float64Array([1.5, -0, NaN]));
  const r = Array.from(s, (x) => x, 5);
  return [r, s];
});
function f508_no_Fixed(s) {
  return Fixed.from(s, box.get);
}
run("floats_method_no_Fixed", () => f508_no_Fixed(new Float64Array([1.5, -0, NaN])));
run("floats_func_no_A", () => {
  let s = keep(new Float64Array([1.5, -0, NaN]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    });
  return r;
});
function f514_prim_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  }, 5);
}
run("floats_turn_prim_A", () => f514_prim_A(new Float64Array([1.5, -0, NaN])));
run("floats_kinds_no_A", () => {
  let s = keep(new Float64Array([1.5, -0, NaN]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6]);
  return r;
});
run("floats_native_undef_Own", () => {
  let s = keep(new Float64Array([1.5, -0, NaN]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, Math.abs, void 0);
  return r;
});
run("floats_asyncs_obj_A", () => {
  let s = keep(new Float64Array([1.5, -0, NaN]));
  const r = Array.from(s, async (x) => x, { v: 4 });
  return [r, s];
});
run("bytevals_none_no_A", () => {
  let s = keep(new Uint8Array([1, 2, 250]).values());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s);
  return r;
});
run("bytevals_first_no_Plain", () => {
  let s = keep(new Uint8Array([1, 2, 250]).values());
  const r = { from: Array.from }.from(s, (x) => x);
  return [r, s];
});
run("bytevals_bound_no_Sub", () => {
  let s = keep(new Uint8Array([1, 2, 250]).values());
  const r = Sub.from(s, box.get.bind(box));
  return [r, s];
});
run("bytevals_holed_no_A", () => {
  let s = keep(new Uint8Array([1, 2, 250]).values());
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
function f538_no_Fixed(s) {
  return Fixed.from(s, 5);
}
run("bytevals_notfn_no_Fixed", () => f538_no_Fixed(new Uint8Array([1, 2, 250]).values()));
function f541_obj_A(s) {
  return Array.from(s, parseInt, { v: 4 });
}
run("bytevals_parse_obj_A", () => f541_obj_A(new Uint8Array([1, 2, 250]).values()));
function f544_no_Fixed(s) {
  return Fixed.from(s, (x, k) => ({ k, x }));
}
run("bytevals_objs_no_Fixed", () => f544_no_Fixed(new Uint8Array([1, 2, 250]).values()));
function f547_undef_A(s) {
  return Array.from(s, (x, k) => show(x) + k, void 0);
}
run("args_arrow_undef_A", () => f547_undef_A(function(...a) {
  return arguments;
}(1, 2, 3)));
run("args_named_no_A", () => {
  let s = keep(function(...a) {
    return arguments;
  }(1, 2, 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, named);
  return r;
});
run("args_shrink_undef_A", () => {
  let s = keep(function(...a) {
    return arguments;
  }(1, 2, 3));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    }, void 0);
  return r;
});
run("args_holed_no_Plain", () => {
  let s = keep(function(...a) {
    return arguments;
  }(1, 2, 3));
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("args_klass_no_A", () => {
  let s = keep(function(...a) {
    return arguments;
  }(1, 2, 3));
  const r = Array.from(s, class Z {
  });
  return [r, s];
});
run("args_asyncs_undef_A", () => {
  let s = keep(function(...a) {
    return arguments;
  }(1, 2, 3));
  const r = Array.from(s, async (x) => x, void 0);
  return [r, s];
});
run("args_set_prim_A", () => {
  let s = keep(function(...a) {
    return arguments;
  }(1, 2, 3));
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  }, 5);
  return [r, s];
});
run("text_first_obj_Plain", () => {
  let s = keep("a\uD83D\uDE00b");
  const r = { from: Array.from }.from(s, (x) => x, { v: 4 });
  return [r, s];
});
function f574_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("text_throws_no_A", () => f574_no_A("a\uD83D\uDE00b"));
function f577_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("text_turn_no_A", () => f577_no_A("a\uD83D\uDE00b"));
run("text_kinds_no_Own", () => {
  let s = keep("a\uD83D\uDE00b");
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6]);
  return r;
});
run("text_count_no_A", () => {
  let s = keep("a\uD83D\uDE00b");
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls);
  return r;
});
run("text_set_no_Plain", () => {
  let s = keep("a\uD83D\uDE00b");
  const r = { from: Array.from }.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  });
  return [r, s];
});
run("textobj_first_no_Sub", () => {
  let s = keep(new String("xy"));
  const r = Sub.from(s, (x) => x);
  return [r, s];
});
run("textobj_bound_no_Plain", () => {
  let s = keep(new String("xy"));
  const r = { from: Array.from }.from(s, box.get.bind(box));
  return [r, s];
});
run("textobj_grow_no_A", () => {
  let s = keep(new String("xy"));
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
function f598_no_Fixed(s) {
  return Fixed.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("textobj_turn_no_Fixed", () => f598_no_Fixed(new String("xy")));
function f604_no_Fixed(s) {
  return Fixed.from(s, parseInt);
}
run("textobj_parse_no_Fixed", () => f604_no_Fixed(new String("xy")));
run("textobj_count_no_A", () => {
  let s = keep(new String("xy"));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls);
  return r;
});
function f610_prim_Fixed(s) {
  return Fixed.from(s, (x, k) => show(x) + k, 5);
}
run("set_arrow_prim_Fixed", () => f610_prim_Fixed(new Set([3, 1, 2])));
function f613_no_A(s) {
  return Array.from(s, box.get);
}
run("set_method_no_A", () => f613_no_A(new Set([3, 1, 2])));
run("set_func_no_Own", () => {
  let s = keep(new Set([3, 1, 2]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    });
  return r;
});
run("set_grow_no_A", () => {
  let s = keep(new Set([3, 1, 2]));
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("set_klass_no_Plain", () => {
  let s = keep(new Set([3, 1, 2]));
  const r = { from: Array.from }.from(s, class Z {
  });
  return [r, s];
});
run("set_asyncs_no_Sub", () => {
  let s = keep(new Set([3, 1, 2]));
  const r = Sub.from(s, async (x) => x);
  return [r, s];
});
function f628_no_A(s) {
  return Array.from(s, (x, k) => ({ k, x }));
}
run("set_objs_no_A", () => f628_no_A(new Set([3, 1, 2])));
run("map_named_obj_Own", () => {
  let s = keep(new Map([[1, "a"], [2, "b"]]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, named, { v: 4 });
  return r;
});
function f634_no_A(s) {
  return Array.from(s, box.get);
}
run("map_method_no_A", () => f634_no_A(new Map([[1, "a"], [2, "b"]])));
function f637_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("map_throws_no_A", () => f637_no_A(new Map([[1, "a"], [2, "b"]])));
run("map_shrink_no_Own", () => {
  let s = keep(new Map([[1, "a"], [2, "b"]]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
function f643_undef_A(s) {
  return Array.from(s, 5, void 0);
}
run("map_notfn_undef_A", () => f643_undef_A(new Map([[1, "a"], [2, "b"]])));
run("map_native_no_A", () => {
  let s = keep(new Map([[1, "a"], [2, "b"]]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs);
  return r;
});
run("map_asyncs_no_Plain", () => {
  let s = keep(new Map([[1, "a"], [2, "b"]]));
  const r = { from: Array.from }.from(s, async (x) => x);
  return [r, s];
});
run("gen_named_prim_A", () => {
  let s = keep(gen());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, named, 5);
  return r;
});
run("gen_func_obj_A", () => {
  let s = keep(gen());
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    }, { v: 4 });
  return r;
});
run("gen_grow_undef_Plain", () => {
  let s = keep(gen());
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  }, void 0);
  return [r, s];
});
run("gen_holed_no_A", () => {
  let s = keep(gen());
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("gen_klass_obj_Plain", () => {
  let s = keep(gen());
  const r = { from: Array.from }.from(s, class Z {
  }, { v: 4 });
  return [r, s];
});
function f667_no_A(s) {
  return Array.from(s, parseInt);
}
run("gen_parse_no_A", () => f667_no_A(gen()));
function f673_no_A(s) {
  return Array.from(s, (x, k) => show(x) + k);
}
run("like_arrow_no_A", () => f673_no_A({ length: 3, 0: "a", 2: "c" }));
run("like_named_no_Own", () => {
  let s = keep({ length: 3, 0: "a", 2: "c" });
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, named);
  return r;
});
run("like_bound_no_A", () => {
  let s = keep({ length: 3, 0: "a", 2: "c" });
  const r = Array.from(s, box.get.bind(box));
  return [r, s];
});
run("like_shrink_no_A", () => {
  let s = keep({ length: 3, 0: "a", 2: "c" });
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
run("like_holed_no_Plain", () => {
  let s = keep({ length: 3, 0: "a", 2: "c" });
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  });
  return [r, s];
});
run("like_klass_no_Sub", () => {
  let s = keep({ length: 3, 0: "a", 2: "c" });
  const r = Sub.from(s, class Z {
  });
  return [r, s];
});
run("like_set_no_A", () => {
  let s = keep({ length: 3, 0: "a", 2: "c" });
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  });
  return [r, s];
});
run("iter_first_undef_Plain", () => {
  let s = keep(iterable());
  const r = { from: Array.from }.from(s, (x) => x, void 0);
  return [r, s];
});
run("iter_bound_prim_Sub", () => {
  let s = keep(iterable());
  const r = Sub.from(s, box.get.bind(box), 5);
  return [r, s];
});
function f703_no_A(s) {
  return Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  });
}
run("iter_turn_no_A", () => f703_no_A(iterable()));
function f706_prim_Fixed(s) {
  return Fixed.from(s, 5, 5);
}
run("iter_notfn_prim_Fixed", () => f706_prim_Fixed(iterable()));
run("iter_klass_no_A", () => {
  let s = keep(iterable());
  const r = Array.from(s, class Z {
  });
  return [r, s];
});
run("iter_count_no_Own", () => {
  let s = keep(iterable());
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, () => ++calls);
  return r;
});
run("iter_set_no_A", () => {
  let s = keep(iterable());
  const r = Array.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  });
  return [r, s];
});
run("num_named_obj_A", () => {
  let s = keep(5);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, named, { v: 4 });
  return r;
});
run("num_grow_no_A", () => {
  let s = keep(5);
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  });
  return [r, s];
});
run("num_holed_obj_Plain", () => {
  let s = keep(5);
  const r = { from: Array.from }.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  }, { v: 4 });
  return [r, s];
});
function f727_no_A(s) {
  return Array.from(s, 5);
}
run("num_notfn_no_A", () => f727_no_A(5));
function f730_no_A(s) {
  return Array.from(s, parseInt);
}
run("num_parse_no_A", () => f730_no_A(5));
function f733_no_A(s) {
  return Array.from(s, (x, k) => ({ k, x }));
}
run("num_objs_no_A", () => f733_no_A(5));
function f736_no_Fixed(s) {
  return Fixed.from(s, (x, k) => show(x) + k);
}
run("undef_arrow_no_Fixed", () => f736_no_Fixed(void 0));
function f742_prim_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  }, 5);
}
run("undef_throws_prim_A", () => f742_prim_A(void 0));
run("undef_shrink_no_A", () => {
  let s = keep(void 0);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    });
  return r;
});
run("undef_kinds_undef_Own", () => {
  let s = keep(void 0);
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6], void 0);
  return r;
});
run("undef_native_prim_A", () => {
  let s = keep(void 0);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs, 5);
  return r;
});
run("undef_count_obj_A", () => {
  let s = keep(void 0);
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls, { v: 4 });
  return r;
});
run("undef_set_undef_Plain", () => {
  let s = keep(void 0);
  const r = { from: Array.from }.from(s, (x, k) => {
    if (k === 0)
      Object.setPrototypeOf(s ?? {}, Array.prototype);
    return show(x);
  }, void 0);
  return [r, s];
});
run("nul_first_prim_Sub", () => {
  let s = keep(null);
  const r = Sub.from(s, (x) => x, 5);
  return [r, s];
});
run("nul_bound_obj_Plain", () => {
  let s = keep(null);
  const r = { from: Array.from }.from(s, box.get.bind(box), { v: 4 });
  return [r, s];
});
function f763_no_A(s) {
  return Array.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("nul_throws_no_A", () => f763_no_A(null));
function f766_prim_Fixed(s) {
  return Fixed.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s) && k < 6)
      s[k + 1] = 0.5;
    return show(x);
  }, 5);
}
run("nul_turn_prim_Fixed", () => f766_prim_Fixed(null));
run("nul_native_no_Own", () => {
  let s = keep(null);
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, Math.abs);
  return r;
});
run("nul_asyncs_no_A", () => {
  let s = keep(null);
  const r = Array.from(s, async (x) => x);
  return [r, s];
});
run("symlen_none_no_Own", () => {
  let s = keep({ length: "2", 0: 1, 1: 2 });
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s);
  return r;
});
run("symlen_named_no_A", () => {
  let s = keep({ length: "2", 0: 1, 1: 2 });
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, named);
  return r;
});
run("symlen_func_undef_Own", () => {
  let s = keep({ length: "2", 0: 1, 1: 2 });
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    }, void 0);
  return r;
});
run("symlen_grow_obj_A", () => {
  let s = keep({ length: "2", 0: 1, 1: 2 });
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && Object.isExtensible(s) && s.length < 9)
      s.push(k);
    return show(x);
  }, { v: 4 });
  return [r, s];
});
run("symlen_klass_undef_Plain", () => {
  let s = keep({ length: "2", 0: 1, 1: 2 });
  const r = { from: Array.from }.from(s, class Z {
  }, void 0);
  return [r, s];
});
run("symlen_asyncs_prim_Sub", () => {
  let s = keep({ length: "2", 0: 1, 1: 2 });
  const r = Sub.from(s, async (x) => x, 5);
  return [r, s];
});
run("symlen_count_no_A", () => {
  let s = keep({ length: "2", 0: 1, 1: 2 });
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, () => ++calls);
  return r;
});
run("arrlike_first_no_Sub", () => {
  let s = keep(Object.create([7, 8, 9]));
  const r = Sub.from(s, (x) => x);
  return [r, s];
});
function f802_prim_A(s) {
  return Array.from(s, box.get, 5);
}
run("arrlike_method_prim_A", () => f802_prim_A(Object.create([7, 8, 9])));
run("arrlike_func_no_A", () => {
  let s = keep(Object.create([7, 8, 9]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, function(x, k) {
      return [this === void 0 ? "u" : typeof this, show(x), k, arguments.length].join();
    });
  return r;
});
run("arrlike_shrink_undef_Own", () => {
  let s = keep(Object.create([7, 8, 9]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Own.from(s, (x, k) => {
      if (Array.isArray(s) && !Object.isFrozen(s) && k === 1)
        s.length = 2;
      return show(x);
    }, void 0);
  return r;
});
run("arrlike_kinds_prim_A", () => {
  let s = keep(Object.create([7, 8, 9]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, (x, k) => [1, 2.5, "z", { k }, void 0, null][k % 6], 5);
  return r;
});
run("arrlike_native_obj_A", () => {
  let s = keep(Object.create([7, 8, 9]));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs, { v: 4 });
  return r;
});
run("arrlike_asyncs_undef_Plain", () => {
  let s = keep(Object.create([7, 8, 9]));
  const r = { from: Array.from }.from(s, async (x) => x, void 0);
  return [r, s];
});
run("proxy_first_no_Plain", () => {
  let s = keep(new Proxy([1, 2, 3], {}));
  const r = { from: Array.from }.from(s, (x) => x);
  return [r, s];
});
run("proxy_bound_no_A", () => {
  let s = keep(new Proxy([1, 2, 3], {}));
  const r = Array.from(s, box.get.bind(box));
  return [r, s];
});
function f826_no_Fixed(s) {
  return Fixed.from(s, (x, k) => {
    if (k === 2)
      throw Error("at " + k);
    return k;
  });
}
run("proxy_throws_no_Fixed", () => f826_no_Fixed(new Proxy([1, 2, 3], {})));
run("proxy_holed_prim_A", () => {
  let s = keep(new Proxy([1, 2, 3], {}));
  const r = Array.from(s, (x, k) => {
    if (Array.isArray(s) && !Object.isFrozen(s) && !Object.isSealed(s))
      delete s[k + 1];
    return show(x);
  }, 5);
  return [r, s];
});
function f832_no_Fixed(s) {
  return Fixed.from(s, 5);
}
run("proxy_notfn_no_Fixed", () => f832_no_Fixed(new Proxy([1, 2, 3], {})));
run("proxy_native_no_A", () => {
  let s = keep(new Proxy([1, 2, 3], {}));
  let r;
  for (let k = 0;k < 2; k++)
    r = Array.from(s, Math.abs);
  return r;
});
console.log(total);

export {};
