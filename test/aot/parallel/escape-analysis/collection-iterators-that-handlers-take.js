// An iterator of a Map or a Set made inside a try block, by tslib's `m.call(o)` or by hand: the handler finds it where the throw left it.
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

function downleveled(xs, at) {
  var e_1,
    _a,
    out = [];
  try {
    for (var xs_1 = __values(xs), xs_1_1 = xs_1.next(); !xs_1_1.done; xs_1_1 = xs_1.next()) {
      var x = xs_1_1.value;
      out.push(refuse(typeof x === "object" ? x[0] : x, at));
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

function goesOnInCatch(set, at) {
  var it,
    r,
    out = [];
  try {
    it = set.values();
    for (r = it.next(); !r.done; r = it.next()) out.push(refuse(r.value, at));
  } catch (e) {
    out.push(e.message);
    for (r = it.next(); !r.done; r = it.next()) out.push(-r.value);
  } finally {
    out.push(it === undefined ? "none" : typeof it.next, it.next().done);
  }
  return out.join();
}

function changedUnderTheIterator(at) {
  var set = new Set([1, 2, 3]),
    it,
    out = [];
  try {
    it = set[Symbol.iterator]();
    for (var r = it.next(); !r.done; r = it.next()) {
      if (set.size < 6) set.add(set.size + 10);
      if (r.value === 2) set.delete(3);
      out.push(refuse(r.value, at));
    }
  } catch (e) {
    set.add("late");
    out.push(e.message);
    for (r = it.next(); !r.done; r = it.next()) out.push(r.value);
    set.add("later");
    out.push(it.next().done);
  }
  return out.join();
}

function clearedInTheHandler(at) {
  var map = new Map([
      [1, "a"],
      [2, "b"],
      [3, "c"],
    ]),
    it,
    out = [];
  try {
    it = map.entries();
    for (var r = it.next(); !r.done; r = it.next()) out.push(refuse(r.value[0], at) + r.value[1]);
  } catch (e) {
    map.clear();
    map.set(9, "z");
    out.push(e.message, String(it.next().value), it.next().done);
  }
  return out.join();
}

function keysAndValues(map, at) {
  var k,
    v,
    out = [];
  try {
    k = map.keys();
    v = Map.prototype.values.call(map);
    for (;;) {
      var a = k.next(),
        b = v.next();
      if (a.done) break;
      out.push(refuse(a.value, at), b.value);
    }
  } catch (e) {
    out.push(e.message, k.next().value, v.next().value);
  }
  return out.join();
}

function wrongReceiver(method, receiver) {
  try {
    return typeof method.call(receiver).next;
  } catch (e) {
    return e instanceof TypeError ? "TypeError" : "other";
  }
}

function withItsOwnReturn(set, at) {
  var closed = 0,
    e_1,
    _a,
    out = [];
  try {
    for (
      var it = __values(set),
        step =
          ((it.return = function () {
            closed++;
            return {};
          }),
          it.next());
      !step.done;
      step = it.next()
    ) {
      if (step.value === at) break;
      out.push(step.value);
    }
  } catch (e_1_1) {
    e_1 = { error: e_1_1 };
  } finally {
    try {
      if (step && !step.done && (_a = it.return)) _a.call(it);
    } finally {
      if (e_1) throw e_1.error;
    }
  }
  return out.join() + " closed " + closed;
}

class Evens extends Set {
  *[Symbol.iterator]() {
    for (const x of super.values()) if (x % 2 === 0) yield x;
  }
}

function keptByTheHandler(set, at) {
  var it;
  try {
    it = set.values();
    refuse(it.next().value, at);
    refuse(it.next().value, at);
  } catch (e) {
    return it;
  }
  return it;
}

const set = new Set([1, 2, 3, 4]);
const map = new Map([
  [1, "a"],
  [2, "b"],
  [3, "c"],
]);
for (let round = 0; round < 3; round++) {
  for (const at of [0, 1, 2, 3, 4, 5]) {
    console.log(
      at,
      downleveled(set, at),
      "|",
      downleveled(map, at),
      "|",
      downleveled([1, 2, 3], at),
      "|",
      downleveled(new Evens([1, 2, 3, 4]), at),
    );
    console.log(at, goesOnInCatch(set, at));
    console.log(at, changedUnderTheIterator(at));
    console.log(at, clearedInTheHandler(at));
    console.log(at, keysAndValues(map, at));
    console.log(at, withItsOwnReturn(set, at));
    console.log(at, [...keptByTheHandler(set, at)].join());
  }
}
console.log(
  wrongReceiver(Set.prototype.values, map),
  wrongReceiver(Map.prototype.entries, set),
  wrongReceiver(Set.prototype.entries, []),
  wrongReceiver(Map.prototype.keys, undefined),
  wrongReceiver(Set.prototype.values, set),
  wrongReceiver(Map.prototype.values, map),
  wrongReceiver(Array.prototype.values, set),
  wrongReceiver(Set.prototype.values, new Evens([2])),
);
