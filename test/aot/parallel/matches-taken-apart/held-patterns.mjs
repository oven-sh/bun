// The exec of a pattern that a capture or a constant holds, in a loop: its result is only tested and read at a few places, and lastIndex is read behind it. Beside them: objects that lose a writable lastIndex, that are compiled anew, that have a method of their own, and another name of the same object. What is printed is what plain Bun prints.
// STATISTIC: RegExpMatchAllocationsElided >= 4
const unseen = x => [x][JSON.parse("0")];
const log = [];
const say = (...parts) => log.push(parts.map(p => (typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : String(p))).join(" "));
const make = () => {
  var A = /(a)(b)?|(c)/y, B = /(\d+)(?:-(\d+))?/g, C = /x(y)?/, D = /([a-z])(?:\1)?/gy, other = { name: A };
  return {
    run(input, start, change) {
      var m, last = start, turns = 0, sum = 0;
      while (turns++ < 30) {
        if (turns === 3 && change) change(A, B, C, D);
        A.lastIndex = last;
        if ((m = A.exec(input))) {
          const before = A.lastIndex;
          other.name.lastIndex = turns & 1 ? before : 0;
          say("A", m[0], m[1], m[2], m[3], before, A.lastIndex);
          last = before;
          continue;
        }
        say(A.lastIndex);
        if ((m = B.exec(input)) !== null) {
          sum += B.lastIndex;
          say("B", m[1], m[2], m.index, B.lastIndex);
          other.name.test(input);
          say(B.lastIndex, A.lastIndex);
        }
        if ((m = C.exec(input))) say("C", m[0], m[1] === undefined, C.lastIndex);
        D.lastIndex = last;
        if ((m = D.exec(input))) { last = D.lastIndex; say("D", m[0].length, m[1], last); input.replace(D, ""); say(D.lastIndex); continue; }
        const any = A.exec(input);
        say(A.lastIndex, any === null);
        last = (+last | 0) + 1;
        if (last > input.length) break;
      }
      say("end", last, sum);
    },
    *tokens(input) {
      let last = 0, m;
      while (last < input.length) {
        D.lastIndex = last;
        if ((m = D.exec(input))) { last = D.lastIndex; yield { type: "D", value: m[0], first: m[1] }; continue; }
        A.lastIndex = last;
        if ((m = A.exec(input))) { last = A.lastIndex; const kept = m; yield kept[0]; say(kept[1], kept.length, m === kept, A.lastIndex); continue; }
        last += 1;
      }
    },
    all: [A, B, C, D],
  };
};
const texts = unseen(["", "abc12-34x", "aabbccx1 2 3", "xyxab\u00ff", "ab\u65e5ab1", "c".repeat(9), "12-", ("--abab9--").slice(2, 7)]);
const changes = [
  null,
  A => { A.lastIndex = "1"; },
  A => { A.lastIndex = { valueOf() { say("valueOf"); return 0; } }; },
  (A, B) => { B.lastIndex = 2.5; },
  (A, B) => { B.lastIndex = { valueOf() { say("valueOf"); B.lastIndex = 0; return 1; } }; },
  A => { A.exec = function (text) { say("own", text.length); return null; }; },
  (A, B, C) => { C.lastIndex = "kept"; },
  (A, B, C, D) => { Object.defineProperty(D, "lastIndex", { writable: false }); },
  A => { Object.freeze(A); },
  (A, B) => { Reflect.set(B, "lastIndex", 3); Object.assign(A, { lastIndex: 1 }); },
];
for (const change of changes) {
  for (const text of texts) for (const start of unseen([0, 1, -1, 1.5, "2", NaN, 99, 2 ** 31, undefined])) {
    const { run } = make();
    try { run(text, start, change); } catch (error) { say(error.name); }
  }
}
for (const text of texts) { const { tokens } = make(); for (const token of tokens(text)) say(typeof token, token.value, token.first); }
console.log(log.length);
console.log(log.join("\n"));
