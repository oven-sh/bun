// Many places in the text each give one function a name of its own while the program runs: a computed key, a definition of `name`, a `displayName`. Each function is dropped before the next one is made. A name is many times as large as everything else in the process, so what the process holds at the end of a round tells whether half of the names are still there.
const size = 2 ** 25;
const textOf = i => String(i).padEnd(size, "a");
const held = () => (Bun.gc(true), process.memoryUsage().rss);

const looked = [
  k => ({ [k]() {} })[k],
  k => ({ [k]: function () {} })[k],
  k => ({ [k]: () => 1 })[k],
  k => Object.defineProperty(function () {}, "name", { value: k }),
  k => Object.defineProperty(() => 1, "name", { value: k }),
  k => ({ [k]() {} })[k],
  k => ({ [k]: function () {} })[k],
  k => ({ [k]: () => 1 })[k],
  k => Object.defineProperty(function () {}, "name", { value: k }),
  k => Object.defineProperty(() => 1, "name", { value: k }),
];
let before = held();
let sum = 0;
for (let i = 0; i < looked.length; i++) {
  sum += looked[i](textOf(i)).name.length;
  Bun.gc(true);
}
console.log("functions that are only looked at", sum, held() - before > (looked.length / 2) * size);

const called = [
  k =>
    ({
      [k]() {
        return 1;
      },
    })[k],
  k =>
    ({
      [k]: function () {
        return 2;
      },
    })[k],
  k => ({ [k]: () => 3 })[k],
  k =>
    Object.defineProperty(
      function () {
        return 4;
      },
      "name",
      { value: k },
    ),
  k => Object.defineProperty(() => 5, "name", { value: k }),
  k =>
    ({
      [k]() {
        return 6;
      },
    })[k],
  k =>
    ({
      [k]: function () {
        return 7;
      },
    })[k],
  k => ({ [k]: () => 8 })[k],
  k =>
    Object.defineProperty(
      function () {
        return 9;
      },
      "name",
      { value: k },
    ),
  k => Object.defineProperty(() => 10, "name", { value: k }),
];
before = held();
sum = 0;
for (let i = 0; i < called.length; i++) {
  const f = called[i](textOf(i));
  sum += f.name.length + f();
  Bun.gc(true);
}
console.log("functions that are called", sum, held() - before > (called.length / 2) * size);

const shown = [
  k => Object.assign(function () {}, { displayName: k }),
  k => Object.assign(() => 1, { displayName: k }),
  k => Object.assign(function () {}, { displayName: k }),
  k => Object.assign(() => 1, { displayName: k }),
  k => Object.assign(function () {}, { displayName: k }),
  k => Object.assign(() => 1, { displayName: k }),
];
before = held();
sum = 0;
for (let i = 0; i < shown.length; i++) {
  sum += shown[i](textOf(i)).displayName.length;
  Bun.gc(true);
}
console.log("functions with a displayName", sum, held() - before > (shown.length / 2) * size);
