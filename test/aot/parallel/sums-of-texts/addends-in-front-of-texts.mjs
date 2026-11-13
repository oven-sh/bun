// A value that nobody knows is added between texts: it is converted once, where it is added, by the rules of +, in front of whatever comes behind.
const log = [];
let count = 0, suffix = "s";
const say = (f, ...given) => {
  try {
    const result = f(...given);
    log.push(typeof result === "string" && result.length > 40 ? result.slice(0, 20) + result.length : String(result));
  } catch (error) {
    log.push(error.constructor.name + " " + count);
  }
};
const hinted = { [Symbol.toPrimitive]: hint => hint + ++count };
const changing = {
  toString() {
    suffix = "changed" + ++count;
    return "c";
  },
};
const throwing = {
  valueOf() {
    throw new RangeError("thrown" + ++count);
  },
};
const long = "0123456789".repeat(60);
const values = ["", "a", "Ж", long, long.slice(1, 400) + count, 0, 7, 255, 256, -1, -0, 1.5, NaN, 1e21, true, null, undefined, 12345678901234567890n, Symbol("s"), hinted, changing, throwing, [1, [2]], {}, new Date(0).getTime(), Object(5n), Object("boxed"), Object.create(null), new Proxy({}, {}), { valueOf: () => 3, toString: () => "never" }];
const between = (x, text) => text + x + "-";
const inFront = (x, text) => x + ", " + " " + text;
const twice = (x, text) => "<" + x + ">" + x + "." + text;
const behindCall = (x, text, f) => text + f(x) + ":" + f(text) + "!";
const readLater = (x, text) => text + x + "|" + suffix + "|" + x + "/";
const bracketed = (x, text) => "[" + (text + x + "]") + "é";
const inTemplate = (x, text) => `${text + x + ";"}${x}`;
function inLoop(x, text) {
  let all = 0;
  for (let i = 0; i < 5; i++) all += (text + x + "_" + i).length + (i + x + "=").length;
  return all;
}
function inTry(x, text) {
  let result = "none";
  try {
    result = text + x + "+";
  } catch (error) {
    result = result + error.message + "?";
  } finally {
    result += count;
  }
  return result;
}
function* yielded(x, text) {
  const sent = yield text + x + ",";
  return text + sent + x + ".";
}
const generated = (x, text) => {
  const steps = yielded(x, text);
  return steps.next().value + steps.next("sent").value;
};
const key = (x, text) => Object.keys({ [text + x + "k"]: 1 })[0];
const pending = [];
async function awaited(x, text) {
  const first = text + x + "~";
  await null;
  return first + x + "^" + text;
}
for (const x of values) {
  for (const text of ["", "t", "Р", long]) {
    for (const f of [between, inFront, twice, readLater, bracketed, inTemplate, inLoop, inTry, generated, key]) say(f, x, text);
    say(behindCall, x, text, v => ((suffix = "from call"), v));
    pending.push(awaited(x, text).then(v => v.length, e => e.constructor.name));
  }
}
console.log(log.join("\n"));
console.log((await Promise.all(pending)).join());
console.log(count, suffix);
