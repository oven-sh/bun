// An array iterator made inside a try block is an argument of the handler. The handler must find it where the throw left it.
var __values = function (o) {
  var s = typeof Symbol === "function" && Symbol.iterator,
    m = s && o[s],
    i = 0;
  if (m) return m.call(o);
  if (o && typeof o.length === "number")
    return {
      next: function () {
        if (o && i >= o.length) o = void 0;
        return { value: o && o[i++], done: !o };
      },
    };
  throw new TypeError(s ? "Object is not iterable." : "Symbol.iterator is not defined.");
};

function refuse(value, at) {
  if (value === at) throw new Error("refused " + value);
  return value;
}

function goesOnInCatch(xs, at) {
  var it,
    r,
    out = [];
  try {
    it = xs[Symbol.iterator]();
    for (r = it.next(); !r.done; r = it.next()) {
      if (r.value === at) throw new Error("at " + r.value);
      out.push(r.value);
    }
  } catch (e) {
    out.push(e.message);
    if (it) for (r = it.next(); !r.done; r = it.next()) out.push(-r.value);
  } finally {
    out.push(it === undefined ? "none" : typeof it.next);
  }
  return out.join();
}

function calleeThrows(xs, at) {
  var it,
    r,
    out = [];
  try {
    it = xs.values();
    for (r = it.next(); !r.done; r = it.next()) out.push(refuse(r.value, at));
  } catch (e) {
    out.push(e.message, it.next().value, it.next().done);
  }
  return out.join();
}

function stepsTwiceInOneStatement(xs, at) {
  var it,
    out = [];
  try {
    it = xs.values();
    for (;;) {
      var a = it.next(),
        b = refuse(it.next().value, at),
        c = it.next();
      out.push(a.value, b, c.value);
      if (c.done) break;
    }
  } catch (e) {
    out.push(e.message, String(it.next().value));
  }
  return out.join();
}

function downleveled(xs, at) {
  var e_1,
    _a,
    out = [];
  try {
    for (var xs_1 = __values(xs), xs_1_1 = xs_1.next(); !xs_1_1.done; xs_1_1 = xs_1.next()) {
      var x = xs_1_1.value;
      out.push(refuse(x, at));
    }
  } catch (e_1_1) {
    e_1 = { error: e_1_1 };
  } finally {
    try {
      if (xs_1_1 && !xs_1_1.done && (_a = xs_1.return)) _a.call(xs_1);
    } finally {
      if (e_1) out.push(e_1.error.message, xs_1 && String(xs_1.next().value));
    }
  }
  return out.join();
}

function notIterable(o) {
  var e_1,
    _a,
    out = [];
  try {
    for (var o_1 = __values(o), o_1_1 = o_1.next(); !o_1_1.done; o_1_1 = o_1.next()) out.push(o_1_1.value);
  } catch (e_1_1) {
    e_1 = { error: e_1_1 };
  } finally {
    try {
      if (o_1_1 && !o_1_1.done && (_a = o_1.return)) _a.call(o_1);
    } finally {
      if (e_1) out.push(e_1.error instanceof TypeError, typeof o_1, typeof o_1_1);
    }
  }
  return out.join();
}

function leavesEarly(xs, at) {
  var it,
    out = [];
  try {
    it = xs.entries();
    for (var r = it.next(); !r.done; r = it.next()) {
      if (r.value[1] === at) break;
      out.push(r.value[0]);
    }
  } finally {
    out.push(String(it.next().value));
  }
  return out.join();
}

function listGrowsUnderTheIterator(at) {
  var xs = [1, 2, 3],
    it,
    out = [];
  try {
    it = xs.keys();
    for (var r = it.next(); !r.done; r = it.next()) {
      if (xs.length < 6) xs.push(xs.length + 1);
      out.push(refuse(r.value, at));
    }
  } catch (e) {
    xs.length = 5;
    out.push(e.message);
    for (r = it.next(); !r.done; r = it.next()) out.push(r.value * 10);
    out.push(it.next().done);
  }
  return out.join();
}

function keptByTheHandler(xs, at) {
  var it;
  try {
    it = xs.values();
    refuse(it.next().value, at);
    refuse(it.next().value, at);
  } catch (e) {
    return it;
  }
  return it;
}

function nested(xs, ys, at) {
  var a,
    b,
    out = [];
  try {
    a = xs.values();
    for (var r = a.next(); !r.done; r = a.next()) {
      try {
        b = ys.values();
        for (var q = b.next(); !q.done; q = b.next()) out.push(refuse(r.value * q.value, at));
      } catch (e) {
        out.push("inner", b.next().value);
        if (r.value === 2) throw e;
      }
    }
  } catch (e) {
    out.push("outer", a.next().value, b.next().value);
  }
  return out.join();
}

const list = [1, 2, 3, 4];
for (let round = 0; round < 3; round++) {
  for (const at of [0, 1, 2, 3, 4, 5]) {
    console.log(at, goesOnInCatch(list, at));
    console.log(at, calleeThrows(list, at));
    console.log(at, stepsTwiceInOneStatement([1, 2, 3, 4, 5, 6, 7], at));
    console.log(at, downleveled(list, at));
    console.log(at, leavesEarly(list, at));
    console.log(at, listGrowsUnderTheIterator(at));
    console.log(at, [...keptByTheHandler(list, at)].join());
    console.log(at, nested([1, 2, 3], [1, 2], at));
  }
}
console.log(
  notIterable(5),
  "|",
  notIterable(undefined),
  "|",
  notIterable({ length: 2, 0: "a", 1: "b" }),
  "|",
  notIterable("xy"),
);
