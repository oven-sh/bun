// reduce and reduceRight of typed arrays: with and without a first value, what the callback is handed, what is refused and in which order, and views whose buffer is detached, shrunk or grown by the callback.
const methods = ["reduce", "reduceRight"];
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
  new Uint8ClampedArray([0, 128, 255]),
  new Uint32Array([4294967295, 1]),
  new Float16Array([1.5, -0]),
  new Float64Array([0.1, -0, NaN]),
  new BigInt64Array([1n, -2n, 3n]),
  new Int32Array([9]),
  new Int32Array(0),
  Buffer.from([7, 8, 9]),
];
for (const view of views) {
  for (const method of methods) {
    for (const first of [[], [undefined], [10], ["s"], [null]]) {
      const seen = [];
      attempt(view.constructor.name + " " + method + " " + first.map(show).join(), () =>
        view[method](
          function (accumulator, element, index, whole) {
            "use strict";
            seen.push(
              show(accumulator) +
                "," +
                show(element) +
                "@" +
                index +
                (whole === view ? "" : "?") +
                arguments.length +
                show(this),
            );
            return typeof element === "bigint" ? element : String(accumulator) + element;
          },
          ...first,
        ),
      );
      console.log(seen.join(" "));
    }
  }
}
const numbers = new Int32Array([5, 6, 7, 8]);
for (const method of methods) {
  const f = Int8Array.prototype[method];
  console.log(method, f.name, f.length, String(f));
  for (const callback of [undefined, null, 1, "text", {}, Symbol.iterator]) {
    attempt(method + " callback " + show(callback), () => numbers[method](callback));
    attempt(method + " callback of an empty view " + show(callback), () => new Int8Array(0)[method](callback));
  }
  for (const receiver of [undefined, null, 1, {}, [1, 2], new DataView(new ArrayBuffer(4))]) {
    attempt(method + " receiver " + show(receiver), () => f.call(receiver, (a, b) => a + b));
    attempt(method + " receiver and callback " + show(receiver), () => f.call(receiver, 1));
  }
  attempt(method + " class", () => numbers[method](class Callee {}));
  attempt(method + " native", () => numbers[method](Math.max));
  attempt(method + " bound", () =>
    numbers[method](
      function (extra, a, b) {
        return a + b + extra + this.more;
      }.bind({ more: 100 }, 1),
    ),
  );
  attempt(method + " throws", () =>
    numbers[method]((a, b, index) => {
      if (index === 2) throw new RangeError("at " + index);
      return a + b;
    }),
  );
  attempt(method + " extra arguments", () => numbers[method]((a, b) => a + b, 1, 2, 3));

  const detachedBefore = new Int32Array([1, 2, 3]);
  structuredClone(detachedBefore.buffer, { transfer: [detachedBefore.buffer] });
  attempt(method + " detached before", () => detachedBefore[method]((a, b) => a + b));
  attempt(method + " detached before, no callback", () => detachedBefore[method](1));

  const detached = new Int32Array([1, 2, 3, 4]);
  attempt(method + " detached inside", () =>
    detached[method]((a, b, index) => {
      if (detached.length) structuredClone(detached.buffer, { transfer: [detached.buffer] });
      return a + "|" + show(b) + "@" + index;
    }),
  );

  const buffer = new ArrayBuffer(16, { maxByteLength: 32 });
  const tracking = new Int32Array(buffer);
  tracking.set([1, 2, 3, 4]);
  attempt(method + " shrunk inside", () =>
    tracking[method]((a, b, index) => (buffer.resize(8), a + "|" + show(b) + "@" + index)),
  );
  buffer.resize(8);
  attempt(method + " grown inside", () =>
    tracking[method]((a, b, index) => (buffer.resize(24), a + "|" + show(b) + "@" + index), "first"),
  );
}
let sum = 0;
const large = new Float64Array(5000).map((_, index) => index / 2);
const ints = new Int32Array(5000).map((_, index) => index);
for (let round = 0; round < 20; round++)
  sum +=
    large.reduce((a, b) => a + b) +
    large.reduceRight((a, b) => a + b, round) +
    ints.reduce((a, b) => a + b, 0) +
    ints.reduceRight((a, b) => Math.max(a, b));
console.log(sum);
