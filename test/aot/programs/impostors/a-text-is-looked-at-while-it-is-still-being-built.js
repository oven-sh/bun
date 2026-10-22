function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

function snapshots(pieces) {
  let text = "";
  const seen = [];
  for (const piece of pieces) {
    text += piece;
    seen.push(text);
  }
  return seen;
}

function lengthsOnTheWay(pieces) {
  let text = "";
  const seen = [];
  for (const piece of pieces) {
    text += piece;
    seen.push(text.length);
  }
  return seen;
}

function lastCharacters(pieces) {
  let text = "";
  const seen = [];
  for (const piece of pieces) {
    text += piece;
    seen.push(text[text.length - 1]);
  }
  return seen;
}

function kindsOnTheWay(pieces) {
  let text;
  const seen = [];
  for (const piece of pieces) {
    text = text === undefined ? piece : text + piece;
    seen.push(typeof text);
  }
  return [seen, text];
}

function withItself(pieces) {
  let text = "";
  for (const piece of pieces) text = text + piece + text;
  return text;
}

function twoAtOnce(pieces) {
  let left = "";
  let right = "";
  for (const piece of pieces) {
    left += piece;
    right += left;
    left += right.length;
  }
  return [left, right];
}

function resetHalfway(pieces) {
  let text = "";
  const lines = [];
  for (const piece of pieces) {
    if (piece === "\n") {
      lines.push(text);
      text = "";
    } else {
      text += piece;
    }
  }
  lines.push(text);
  return lines;
}

function* yieldedOnTheWay(pieces) {
  let text = "";
  for (const piece of pieces) {
    text += piece;
    yield text;
  }
}

function inAnElement(pieces) {
  const parts = ["", 0];
  for (const piece of pieces) {
    parts[0] += piece;
    parts[1] += piece;
  }
  return parts;
}

function stoppedEarly(pieces) {
  let text = "";
  outer: for (const piece of pieces) {
    for (const inner of [piece, piece]) {
      if (inner === null) break outer;
      if (inner === undefined) continue outer;
      text += inner;
    }
  }
  return text;
}

function inFinally(pieces) {
  let text = "";
  const seen = [];
  for (const piece of pieces) {
    try {
      text += piece;
    } catch (error) {
      text += "[" + error.constructor.name + "]";
    } finally {
      seen.push(text);
    }
  }
  return seen;
}

function seenByEval(pieces) {
  let text = "";
  const seen = [];
  for (const piece of pieces) {
    text += piece;
    seen.push(eval("text.length"));
  }
  return seen;
}

const uses = [
  ["snapshots", snapshots],
  ["lengths", lengthsOnTheWay],
  ["last characters", lastCharacters],
  ["kinds", kindsOnTheWay],
  ["with itself", withItself],
  ["two at once", twoAtOnce],
  ["reset halfway", resetHalfway],
  ["yielded", pieces => [...yieldedOnTheWay(pieces)]],
  ["in an element", inAnElement],
  ["stopped early", stoppedEarly],
  ["in finally", inFinally],
  ["seen by eval", seenByEval],
];

const lists = [
  "['a', 'b', 'c']",
  "['ab', '', 'cd']",
  "['a', 1, 'b']",
  "[1, 2, 'a', 3]",
  "[1, 2, 3]",
  "['a', '\\n', 'b', '\\n']",
  "['a', null, 'b']",
  "['a', undefined, 'b']",
  "['a', -0, 1.5, 1e21]",
  "['a', [1, 2], {}]",
  "['a', new String('b'), 'c']",
  "['\\u00e9', '\\u4e16', 'a']",
  "['\\ud83d', '\\ude00']",
  "['a', Symbol('s'), 'b']",
  "[1n, 2n, 'a']",
  "[1n, 2, 'a']",
  "['a', { toString() { return 'T'; }, valueOf() { return 'V'; } }]",
  "[true, false]",
  "[]",
  "'abc'",
];

let total = 0;
for (let i = 0; i < 1000; i++) {
  for (const [name, use] of uses) {
    if (name !== "seen by eval" || i < 50) total += String(use(["a", "b", "c"])).length;
  }
}
console.log("1000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of lists) attempt(name + " " + text, () => use(make(text)));
}
