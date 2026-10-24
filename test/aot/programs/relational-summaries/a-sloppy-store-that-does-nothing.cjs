// In sloppy code a store that cannot be made is passed over in silence: the function returns as if nothing had happened, and nothing has. "The store is on every path, so the field holds the value when the call is over" is false for a frozen object, a read-only field, an accessor without a setter, a read-only field of the prototype, a primitive, and an index past the end of a fixed array.
function churn(depth) {
  var pair = { left: depth, right: -depth };
  var list = [depth, depth + 1, depth + 2];
  var read = function () {
    return pair.left + list[1];
  };
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
function put(o, v) {
  o.x = v;
}
function putAndRead(o, v) {
  o.x = v;
  return o.x;
}
function putTwo(o, v, w) {
  o.x = v;
  o.y = w;
}
function putAt(list, at, v) {
  list[at] = v;
}
function putByKey(o, key, v) {
  o[key] = v;
}
function remove(o) {
  return delete o.x;
}
function makeAndFreeze(v, hard) {
  var o = { x: 1 };
  if (hard) Object.freeze(o);
  o.x = v;
  return o;
}
function makeAndReadBack(v, hard) {
  var o = { x: 1 };
  if (hard) Object.freeze(o);
  o.x = v;
  return o.x;
}
var weigh = function (x) {
  return typeof x === "number" ? x + 1 : x === undefined ? -1000 : typeof x === "string" ? x.length : x.n * 1000;
};
var readOnlyParent = Object.freeze({ x: 4 });
var getterParent = {
  get x() {
    return 5;
  },
};
var makers = [
  function () {
    return { x: 1 };
  },
  function () {
    return Object.freeze({ x: 1 });
  },
  function () {
    return Object.defineProperty({}, "x", { value: 2, writable: false, configurable: true, enumerable: true });
  },
  function () {
    return {
      get x() {
        return 3;
      },
    };
  },
  function () {
    return Object.create(readOnlyParent);
  },
  function () {
    return Object.create(getterParent);
  },
  function () {
    return Object.preventExtensions({});
  },
  function () {
    return Object.seal({ x: 1 });
  },
];
var total = 0;
var lines = [];
for (var i = 0; i < 400; i++) {
  var v = { n: i, tag: "v" + i };
  var row = [];
  for (var m = 0; m < makers.length; m++) {
    var a = makers[m]();
    put(a, v);
    total += weigh(a.x);
    var b = makers[m]();
    total += weigh(putAndRead(b, v));
    var c = makers[m]();
    putTwo(c, v, i);
    total += weigh(c.x) + weigh(c.y);
    var d = makers[m]();
    putByKey(d, "x", v);
    total += weigh(d.x);
    var e = makers[m]();
    total += remove(e) ? 1 : 2;
    total += weigh(e.x);
    row.push(typeof a.x, typeof c.y, typeof e.x);
  }
  put(i, v);
  put("text", v);
  put(true, v);
  total += weigh(putAndRead(i, v)) + weigh(putAndRead("text", v));
  var fixed = Object.freeze([1, 2]);
  putAt(fixed, 0, v);
  putAt(fixed, 5, v);
  var closed = Object.preventExtensions([1, 2]);
  putAt(closed, 0, v);
  putAt(closed, 5, v);
  total += weigh(fixed[0]) + fixed.length + weigh(closed[0]) + closed.length + weigh(closed[5]);
  putAt("text", 0, v);
  var hard = i % 3 === 0;
  total += weigh(makeAndFreeze(v, hard).x) + weigh(makeAndReadBack(v, hard));
  if (i % 133 === 132) {
    churn(30);
    lines.push(row.join());
  }
}
console.log(total, churn(60));
console.log(lines.join("\n"));
