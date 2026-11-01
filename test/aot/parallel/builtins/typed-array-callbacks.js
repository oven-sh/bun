// forEach, every, some, find, findIndex, findLast and findLastIndex of typed arrays: what the callback is handed, where the walk ends, what is refused and in which order, and views whose buffer is detached, shrunk or grown by the callback.
const methods = ["forEach", "every", "some", "find", "findIndex", "findLast", "findLastIndex"];
const show = value =>
  typeof value === "bigint"
    ? value + "n"
    : Object.is(value, -0)
      ? "-0"
      : typeof value === "object" && value !== null
        ? Object.prototype.toString.call(value)
        : String(value);
function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name + ":", error.message);
  }
}

const views = [
  new Int8Array([1, -2, 3]),
  new Uint8Array([1, 2, 255]),
  new Uint8ClampedArray([0, 128, 255]),
  new Int16Array([-1, 2]),
  new Uint16Array([65535, 1]),
  new Int32Array([1, -2147483648, 2147483647]),
  new Uint32Array([4294967295, 0]),
  new Float16Array([1.5, -0, NaN]),
  new Float32Array([1.5, -0, NaN, Infinity]),
  new Float64Array([0.1, -0, NaN, -Infinity]),
  new BigInt64Array([1n, -2n]),
  new BigUint64Array([18446744073709551615n]),
  new Int32Array(0),
  Buffer.from([7, 8, 9]),
  new Uint8Array(new ArrayBuffer(8), 2, 3),
];
for (const view of views) {
  for (const method of methods) {
    const seen = [];
    const result = view[method](function (element, index, whole) {
      seen.push(show(element) + "@" + index + (whole === view ? "" : "?") + arguments.length);
      return index === 1;
    });
    console.log(view.constructor.name, method, show(result), seen.join(" "));
  }
}

const numbers = new Int32Array([5, 6, 7, 8]);
for (const method of methods) {
  const receiver = { tag: "receiver" };
  numbers[method](function () {
    "use strict";
    if (this !== receiver) console.log(method, "strict this differs");
  }, receiver);
  numbers[method](function () {
    if (this !== globalThis) console.log(method, "sloppy this differs");
  });
  numbers[method](function () {
    if (typeof this !== "object" || this.valueOf() !== 3) console.log(method, "boxed this differs");
  }, 3);
  for (const answer of [0, 1, "", "x", null, undefined, NaN, {}, 0n, 1n, -0, Symbol.iterator])
    attempt(method + " answers " + show(answer), () => numbers[method](() => answer));
}

for (const method of methods) {
  const f = Int8Array.prototype[method];
  console.log(
    method,
    f.name,
    f.length,
    f === Float64Array.prototype[method],
    Object.getPrototypeOf(Int8Array.prototype).hasOwnProperty(method),
    String(f),
  );
  for (const callback of [undefined, null, 1, "text", {}, [], Symbol.iterator])
    attempt(method + " callback " + show(callback), () => numbers[method](callback));
  for (const receiver of [
    undefined,
    null,
    1,
    "text",
    {},
    [1, 2],
    new ArrayBuffer(4),
    new DataView(new ArrayBuffer(4)),
    { length: 2, 0: 1, 1: 2 },
  ]) {
    attempt(method + " receiver " + show(receiver), () => f.call(receiver, () => true));
    attempt(method + " receiver and callback " + show(receiver), () => f.call(receiver, 1));
  }
  attempt(method + " class", () => numbers[method](class Callee {}));
  attempt(method + " bound", () =>
    numbers[method](
      function (extra, element) {
        return this.least < element + extra;
      }.bind({ least: 7 }, 1),
    ),
  );
  attempt(method + " native", () => numbers[method](Math.max));
  attempt(method + " proxy", () => numbers[method](new Proxy(x => x > 6, {})));
  attempt(method + " throws", () =>
    numbers[method]((element, index) => {
      if (index === 2) throw new RangeError("at " + index + " of " + method);
      return false;
    }),
  );
}

for (const method of methods) {
  const detachedBefore = new Int32Array([1, 2, 3]);
  structuredClone(detachedBefore.buffer, { transfer: [detachedBefore.buffer] });
  attempt(method + " detached before", () => detachedBefore[method](() => true));
  attempt(method + " detached before, no callback", () => detachedBefore[method](1));

  const detached = new Int32Array([1, 2, 3, 4]);
  const seenDetached = [];
  attempt(method + " detached inside", () =>
    detached[method]((element, index) => {
      seenDetached.push(show(element) + "@" + index);
      if (seenDetached.length === 2) structuredClone(detached.buffer, { transfer: [detached.buffer] });
      return false;
    }),
  );
  console.log(method, seenDetached.join(" "), detached.length);

  const shrinking = new ArrayBuffer(16, { maxByteLength: 32 });
  const tracking = new Int32Array(shrinking);
  tracking.set([1, 2, 3, 4]);
  const seenShrunk = [];
  attempt(method + " shrunk inside", () =>
    tracking[method]((element, index) => {
      seenShrunk.push(show(element) + "@" + index);
      if (seenShrunk.length === 1) shrinking.resize(8);
      return false;
    }),
  );
  console.log(method, seenShrunk.join(" "), tracking.length);

  const growing = new ArrayBuffer(8, { maxByteLength: 32 });
  const grown = new Int32Array(growing);
  grown.set([1, 2]);
  const seenGrown = [];
  attempt(method + " grown inside", () =>
    grown[method]((element, index) => {
      seenGrown.push(show(element) + "@" + index);
      if (seenGrown.length === 1) growing.resize(24);
      return false;
    }),
  );
  console.log(method, seenGrown.join(" "), grown.length);

  const fixedOverShrunk = new ArrayBuffer(16, { maxByteLength: 32 });
  const fixed = new Int32Array(fixedOverShrunk, 4, 3);
  fixedOverShrunk.resize(8);
  attempt(method + " out of bounds before", () => fixed[method](() => true));

  const stored = new Int32Array([1, 2, 3, 4]);
  const seenStored = [];
  stored[method]((element, index, whole) => {
    seenStored.push(element);
    whole[(index + 1) % 4] = element * 10;
    whole[(index + 3) % 4] = -element;
    return false;
  });
  console.log(method, seenStored.join(" "), stored.join(" "));
}

class Odd extends Uint8Array {
  get length() {
    return 1;
  }
}
const odd = new Odd([1, 2, 3]);
for (const method of methods) {
  let calls = 0;
  odd[method](() => (calls++, false));
  console.log(method, "ignores a length of its own", calls);
}

let sum = 0;
const large = new Float64Array(5000).map((_, index) => index / 2);
for (let round = 0; round < 20; round++) {
  large.forEach(x => {
    sum += x;
  });
  sum +=
    large.findIndex(x => x > 2000) +
    large.findLastIndex(x => x < 10) +
    large.find(x => x > 100.25) +
    large.findLast(x => x < 3) +
    +large.every(x => x >= 0) +
    +large.some(x => x > 1e9);
}
console.log(sum);
