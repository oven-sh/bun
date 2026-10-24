// Each function that native code calls is a function of its own: what it sees as `this`, and how many arguments arrive.
"use strict";
const lines = [];
const target = new EventTarget();
const controller = new AbortController();
setTimeout(function () {
  lines.push(
    "1 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
}, 0);
setTimeout(
  function () {
    lines.push(
      "2 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
    );
  },
  0,
  1,
  2,
);
setImmediate(function () {
  lines.push(
    "3 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
setImmediate(function () {
  lines.push(
    "4 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
}, 1);
queueMicrotask(function () {
  lines.push(
    "5 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
process.nextTick(function () {
  lines.push(
    "6 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
process.nextTick(function () {
  lines.push(
    "7 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
}, 1);
target.addEventListener("ping", function () {
  lines.push(
    "8 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
controller.signal.addEventListener("abort", function () {
  lines.push(
    "9 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
controller.signal.onabort = function () {
  lines.push(
    "10 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
};
process.on("exit", function () {
  lines.push(
    "11 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
process.once("beforeExit", function () {
  lines.push(
    "12 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
Promise.resolve(1).then(function () {
  lines.push(
    "13 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
[1].forEach(function () {
  lines.push(
    "14 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
[1].forEach(function () {
  lines.push(
    "15 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
}, {});
new Map([[1, 2]]).forEach(function () {
  lines.push(
    "16 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
"a".replace(/a/, function () {
  lines.push(
    "17 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
JSON.parse("[1]", function () {
  lines.push(
    "18 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
JSON.stringify({ a: 1 }, function () {
  lines.push(
    "19 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
Array.from([1], function () {
  lines.push(
    "20 " + (this === undefined ? "undefined" : typeof this) + " " + arguments.length + " " + typeof arguments[0],
  );
});
target.dispatchEvent(new Event("ping"));
controller.abort();
process.on("exit", () => console.log(lines.join("\n")));
