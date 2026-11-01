// Prints whether each stack frame shows the name of its function object, for function objects that one place makes under many names: at every depth of long chains of calls, from frames of several sizes, between collections, behind chains that have returned or were left by an error, and where one takes the place of another in a tail call.
// Flags: --aot-disable=flow-results
Error.stackTraceLimit = Infinity;
const namesIn = stack =>
  stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, "").replace(/ ?\(.*\)$/, ""))
    .filter(name => /^(link|wide|end|jump)\d+$/.test(name));
function make(kind, number, body) {
  const made = function (...rest) {
    return body(made, ...rest) || "";
  };
  Object.defineProperty(made, "name", { value: kind + number });
  return made;
}
const ends = [];
for (let i = 0; i < 8; i++) ends.push(make("end", i, () => new Error("x").stack));
const throwing = make("end", 8, () => {
  throw new Error("thrown");
});
const collecting = make("end", 9, () => {
  Bun.gc(true);
  return new Error("x").stack;
});
const chain = [];
for (let i = 0; i < 3000; i++)
  chain.push(
    i % 3 === 2
      ? make("wide", i, (self, depth, end, a = 1, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7) =>
          depth ? chain[depth - 1](depth - 1, end, b, c, d, e, f, g, a) : end(),
        )
      : make("link", i, (self, depth, end) => (depth ? chain[depth - 1](depth - 1, end) : end())),
  );
const nameOf = made => Object.getOwnPropertyDescriptor(made, "name").value;
function judge(depth, end, stack, ...callers) {
  const names = namesIn(stack);
  const expected = [nameOf(end)];
  for (let i = 0; i <= depth; i++) expected.push(nameOf(chain[i]));
  for (const caller of callers) expected.push(nameOf(caller));
  const wrong = expected.findIndex((name, index) => names[index] !== name);
  return names.length === expected.length && wrong < 0
    ? `${names.length} as made`
    : `${names.length} of ${expected.length}, at ${wrong}: ${names[wrong]} in place of ${expected[wrong]}`;
}
const walk = (depth, end, ...callers) => judge(depth, end, chain[depth](depth, end), ...callers);

const depths = [0, 1, 2, 7, 30, 31, 32, 33, 100, 255, 256, 257, 700, 1500, 2999];
for (const depth of depths) console.log("down", depth, "|", walk(depth, ends[depth & 7]));
for (const depth of depths.toReversed()) console.log("up", depth, "|", walk(depth, ends[(depth + 3) & 7]));

let wrongDepths = 0;
for (let depth = 0; depth < 600; depth++) if (!walk(depth, ends[depth & 7]).endsWith("as made")) wrongDepths++;
console.log("each depth to 600 |", wrongDepths, "wrong");

Bun.gc(true);
console.log("behind a collection |", walk(3, ends[1]), "|", walk(2000, ends[2]), "|", walk(4, ends[3]));
console.log("a collection at the end of a chain |", walk(5, collecting), "|", walk(1200, collecting), "|", walk(6, collecting));

for (const depth of [2, 900, 40, 2500, 1]) {
  try {
    chain[depth](depth, throwing);
  } catch (error) {
    console.log("left by an error", depth, "|", judge(depth, throwing, error.stack), "|", walk(depth >> 1, ends[4]));
  }
}

const below = make("link", 5000, (self, depth) => {
  let said = "";
  for (let round = 0; round < 3; round++) {
    said += walk(depth, ends[round], self) + " . ";
    Bun.gc(true);
  }
  return said + namesIn(new Error("x").stack).join(" < ");
});
console.log("chains below one frame |", below(50), "|", below(1800));

function makeJump(number, next) {
  "use strict";
  const made = function (end) {
    return next ? next(end) : end();
  };
  Object.defineProperty(made, "name", { value: "jump" + number });
  return made;
}
let jump;
for (let i = 0; i < 5; i++) jump = makeJump(i, jump);
console.log("tail calls |", namesIn(jump(ends[5])).join(" < "));
console.log("tail calls below a chain |", namesIn(chain[3](3, () => jump(ends[6]))).join(" < "));
