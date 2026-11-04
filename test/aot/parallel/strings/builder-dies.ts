// A text that grows in a loop and dies unread, is read for the last time through its length, or takes a choice among its parts.
function untilBad(xs: string[]) {
  let s = "";
  for (const x of xs) {
    s += x;
    if (x === "bad") return null;
  }
  return s;
}
function throwsAtBad(xs: string[]) {
  let s = "";
  for (const x of xs) {
    s += x;
    if (x === "bad") throw new Error("bad among " + xs.length);
  }
  return s;
}
function throwsText(xs: string[]) {
  let s = "";
  for (const x of xs) {
    s += x;
    if (x === "bad") throw s;
  }
  return s;
}
function caught(run: (xs: string[]) => string, xs: string[]) {
  try {
    return run(xs);
  } catch (e) {
    return e instanceof Error ? e.message : "thrown " + String(e);
  }
}
function keptByHandler(xs: string[]) {
  let s = "";
  try {
    for (const x of xs) {
      s += x;
      if (x === "bad") throw new Error("stop");
    }
    return "all";
  } catch {
    return s;
  }
}

function joined(xs: string[]) {
  let s = "";
  for (const x of xs) s += x + ",";
  return s;
}
function lengthAlone(xs: string[]) {
  let s = "";
  for (const x of xs) s += x + ",";
  return s.length;
}
// The last operation that reads the text asks for its length on the way.
function withoutLast(xs: string[]) {
  let s = "";
  for (const x of xs) s += x + ",";
  return s.slice(0, -1);
}
function lastTwo(xs: string[]) {
  let s = "";
  for (const x of xs) s += x + ",";
  return s.substring(s.length - 2);
}
function lastCharacter(xs: string[]) {
  let s = "";
  for (const x of xs) s += x + ";";
  return s.at(-1);
}
function endsWithComma(xs: string[]) {
  let s = "";
  for (const x of xs) s += x + ",";
  return s.endsWith(",");
}
function padded(xs: string[]) {
  let s = "";
  for (const x of xs) s += x;
  return s.padEnd(6, ".");
}
function isEmpty(xs: string[]) {
  let s = "";
  for (const x of xs) s += x;
  return s === "";
}

function choiceOfTexts(xs: string[], c: boolean, a: string, d: string, e: string, f: string, g: string) {
  let s = "";
  for (const x of xs) {
    s += a + (c ? d + e : f) + g;
    c = x === "flip" ? !c : c;
  }
  return s;
}
// The sum in front of the text is a sum of numbers.
function choiceOfNumbers(xs: string[], c: boolean, n: number) {
  let s = "";
  for (const x of xs) {
    s += n + (c ? 1 : 2) + x;
    c = !c;
  }
  return s;
}
function choiceOfAnything(xs: string[], c: number) {
  let s = "";
  for (const x of xs) {
    s += "<" + (c === 0 ? undefined : c === 1 ? null : c === 2 ? -0 : c === 3 ? 1n : c === 4 ? true : x + x) + ">";
    c = (c + 1) % 6;
  }
  return s;
}
function choiceBehindOldText(xs: string[], c: boolean) {
  let s = "";
  for (const x of xs) {
    s += x + (c ? ((s += "!"), "yes") : "no");
    c = !c;
  }
  return s;
}
function choiceThatConverts(xs: string[], c: boolean, log: string[]) {
  const tail = {
    toString() {
      log.push("tail");
      return "t";
    },
  };
  let s = "";
  for (const x of xs) {
    s += x + (c ? "1" + x : "2") + tail;
    c = !c;
  }
  return s;
}

const lists = [[], ["a"], ["a", "b", "c"], ["a", "bad", "c"], ["bad"], ["flip", "x", "flip", "y"]];
for (const xs of lists) {
  console.log(JSON.stringify(xs));
  console.log(untilBad(xs), caught(throwsAtBad, xs), caught(throwsText, xs), keptByHandler(xs));
  console.log(joined(xs), lengthAlone(xs), withoutLast(xs), lastTwo(xs), lastCharacter(xs), endsWithComma(xs), padded(xs), isEmpty(xs));
  for (const c of [true, false]) {
    const log: string[] = [];
    console.log(choiceOfTexts(xs, c, "a", "d", "e", "f", "g"), choiceOfNumbers(xs, c, 40), choiceBehindOldText(xs, c), choiceThatConverts(xs, c, log), log.length);
  }
  for (let c = 0; c < 6; c++) console.log(choiceOfAnything(xs, c));
}
