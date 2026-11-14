// A string that starts empty in each iteration and is then appended to a longer one: its parts go into the longer string at once.
// COUNT: operation:operationAOTStackStringBuilderAppend <= 60
function table(rows) {
  let text = "";
  for (let i = 0; i < rows.length; i++) {
    let line = "";
    for (let k = 0; k < rows[i].length; k++) line += rows[i][k] + ",";
    text += line + "\n";
  }
  return text;
}
function segments(list) {
  let result = "", next, line = 1;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    next = "";
    if (item.line !== line) {
      while (item.line !== line) {
        next += ";";
        line++;
      }
    } else if (i > 0) {
      if (item.same) continue;
      next += ",";
    }
    next += item.column.toString(36);
    if (item.name) next += "-" + item.name;
    result += next;
  }
  return result;
}
function ofIterables(rows) {
  let text = "";
  for (const row of rows) {
    var cells = "";
    for (const cell of row) cells += "<" + cell + ">";
    text += cells;
  }
  return text;
}
function leavesBehindPart(words) {
  let text = "[";
  for (const word of words) {
    let piece = "";
    for (let i = 0; i < word.length; i++) {
      piece += word[i];
      if (word[i] === "!") break;
    }
    if (word === "skip") continue;
    text += piece;
  }
  return text + "]";
}
function returnsInside(words) {
  let text = "";
  for (const word of words) {
    let piece = "";
    piece += word;
    if (word === "end") return "stopped";
    text += piece;
  }
  return text;
}
function throwsInside(words, fail) {
  let text = "";
  try {
    for (const word of words) {
      let piece = "";
      piece += word;
      piece += fail(word);
      text += piece;
    }
  } catch (error) {
    return text + "!" + error.message;
  }
  return text;
}
function readsPiece(words) {
  let text = "", last;
  for (const word of words) {
    last = "";
    last += word;
    last += last.length;
    text += last;
  }
  return text + last;
}
function readsLater(words) {
  let text = "", last = "none";
  for (const word of words) {
    last = "";
    last += word;
    text += last;
  }
  return text + "/" + last;
}
function readsWhole(words) {
  let text = "";
  for (const word of words) {
    let piece = "";
    piece += word;
    piece += text.length;
    text += piece;
  }
  return text;
}
function startsAsNumber(words) {
  let text = 1;
  for (const word of words) {
    let piece = "";
    piece += word;
    text += piece;
  }
  return text;
}
function becomesNumber(words) {
  let text = "";
  for (const word of words) {
    let piece = "";
    piece += word;
    text += piece;
    if (word === 3) text = 4;
  }
  return text;
}
function captured(words) {
  let text = "";
  const see = [];
  for (const word of words) {
    let piece = "";
    see.push(() => piece);
    piece += word;
    text += piece;
  }
  return text + see.map(f => f()).join("|");
}
function converts(values) {
  let text = "";
  const order = [];
  for (const value of values) {
    let piece = "";
    piece += (order.push("a"), { toString() { order.push("s" + value); return "s" + value; } });
    piece += { [Symbol.toPrimitive](hint) { order.push(hint); return value; } };
    text += piece + (order.push("b"), value) + value;
  }
  return text + order.join();
}
function shortForms(list) {
  var out = "", p, i;
  for (i = 0; i < list.length; i++) p = "", list[i] & 1 && (p += "odd"), out += p;
  for (i = 0; i < list.length; i++) {
    p = "";
    list[i] & 1 ? (p += "odd", p += i) : (p += "even");
    out += p;
  }
  return out;
}
function chosen(list) {
  let text = "";
  for (const item of list) {
    let piece = "";
    switch (item) {
      case 1: piece += "one"; break;
      case 2: piece += "two";
      default: piece += "many";
    }
    text += piece;
  }
  return text;
}
function labeled(list) {
  let text = "";
  outer: for (const item of list) {
    let piece = "";
    for (let i = 0; i < 4; i++) {
      piece += i;
      if (i === item) continue outer;
    }
    text += piece;
  }
  return text;
}
function* steps(list) {
  let text = "";
  for (const item of list) {
    let piece = "";
    piece += item;
    piece += yield text;
    text += piece;
  }
  return text;
}
function twice(list) {
  let a = "", b = "";
  for (const item of list) {
    let piece = "";
    piece += item;
    a += piece;
    b += piece;
  }
  return a + "/" + b;
}
function nested(rows) {
  let text = "";
  for (const row of rows) {
    let line = "";
    for (const cell of row) {
      let digits = "";
      let rest = cell;
      do {
        digits += "01234567"[rest & 7];
        rest >>>= 3;
      } while (rest > 0);
      line += digits;
    }
    text += line + ";";
  }
  return text;
}
const words = ["ab", "c!d", "skip", "☃x", "", "end"];
const rows = [];
for (let i = 0; i < 12; i++) rows.push(Array.from({ length: i % 5 }, (_, k) => i * 37 + k));
const list = rows.map((row, i) => ({ line: 1 + (i >> 2), column: i * 31, same: i % 3 === 1, name: i % 4 ? "n" + i : "" }));
for (let round = 0; round < 3; round++) {
  console.log(table(rows).length, table([["a", 1.5], [], [null, undefined, "☃"]]));
  console.log(segments(list), ofIterables(rows).length, ofIterables([[1, "x"], "yz"]));
  console.log(leavesBehindPart(words), returnsInside(words), returnsInside(words.slice(0, 3)));
  console.log(throwsInside(words, w => w.length), throwsInside(words, w => { if (w === "skip") throw new Error("no " + w); return w.length; }));
  console.log(readsPiece(words), readsLater(words), readsWhole(words), startsAsNumber(words), becomesNumber([1, 3, 5]));
  console.log(captured(words), converts([1, "x", 2.5]), shortForms([1, 2, 3, 4]));
  console.log(chosen([1, 2, 3]), labeled([1, 9, 2]), twice(words), nested(rows).length, nested([[1, 80], [7]]));
  const it = steps(["p", "q"]);
  console.log(it.next().value, it.next(1).value, JSON.stringify(it.next(2)));
  try { let t = ""; for (const x of ["a", Symbol("s")]) { let p = ""; p += x; t += p; } console.log(t); } catch (e) { console.log(e.name); }
}
