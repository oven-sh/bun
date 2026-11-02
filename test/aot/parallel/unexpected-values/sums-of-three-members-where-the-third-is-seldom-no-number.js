// a + b + c over members that nearly always hold numbers. Now and then the third, or the first, holds something else, and the sum of the first two goes on as it is.
function Reply(headers, status, id) {
  this.headers = headers;
  this.status = status;
  this.id = id;
}
Reply.prototype.total = function () {
  return this.headers + this.status + this.id;
};
function doubled(reply) {
  return (reply.headers + reply.status + reply.id) * 2;
}
function describe(value) {
  return typeof value + ":" + (Object.is(value, -0) ? "-0" : String(value));
}

const usual = [];
for (let i = 0; i < 64; i++) usual.push(new Reply(i, 200, i & 7));
let sum = 0;
for (let turn = 0; turn < 20000; turn++) {
  const reply = usual[turn & 63];
  sum = (sum + reply.total() + doubled(reply)) | 0;
}
console.log("usual", sum);

const firstTwo = [
  [1, 2],
  [0.5, 0.25],
  [-0, -0],
  [2147483647, 1],
  [-2147483648, -1],
  [1e308, 1e308],
  [NaN, 1],
  [Infinity, -Infinity],
  [4294967295, 0.5],
  [9007199254740991, 2],
];
const thirds = ["x", "", 3n, null, undefined, true, { valueOf: () => 7 }, { toString: () => "t" }, [1, 2], Symbol.iterator, 5, -0, 0.5];
for (const [a, b] of firstTwo) {
  const line = [];
  for (const c of thirds) {
    for (const take of [reply => reply.total(), doubled]) {
      try {
        line.push(describe(take(new Reply(a, b, c))));
      } catch (error) {
        line.push(error.constructor.name);
      }
    }
  }
  console.log(describe(a), describe(b), line.join(" "));
}
for (const [a, b, c] of [["a", 1, 2], [1n, 2n, 3n], [1n, 2, 3], [null, 1, 2], [undefined, 1, 2], [{ valueOf: () => 1.5 }, 1, 2], [1, "b", 2]]) {
  for (const take of [reply => reply.total(), doubled]) {
    try {
      console.log(describe(take(new Reply(a, b, c))));
    } catch (error) {
      console.log(error.constructor.name);
    }
  }
}
const late = new Reply(1, 2, 3);
delete late.id;
console.log(describe(late.total()), describe(doubled(late)));
Object.defineProperty(late, "id", { get: () => "got" });
console.log(describe(late.total()), describe(doubled(late)));
