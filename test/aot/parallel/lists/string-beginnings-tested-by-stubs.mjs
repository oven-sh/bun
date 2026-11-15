// STATISTIC: ArrayCallbacksRunByStubs >= 6
// Methods of arrays of which nothing is known, with a callback that asks how an element or a field begins.

const one = Number("1");
let seen = 0;
const parsed = list => JSON.parse(JSON.stringify(list));

// The functions are too large to be copied into the loop.
function beginning(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.filter(x => x.startsWith("ab"));
}
function others(list, turn, start) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.filter(x => !x.startsWith(start));
}
function some(list, turn, start) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.some(x => x.startsWith(start));
}
function find(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.find(x => x.name.startsWith("n1"));
}
function every(list, turn, start) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.every(x => x.name.startsWith(start));
}
function place(list, turn, start) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.findIndex(x => x.name.startsWith(start));
}

const show = answer => (Array.isArray(answer) ? answer.length + "[" + answer.map(x => String(x?.name ?? x)).join(" ") + "]" : typeof answer === "object" && answer ? "o" + String(answer.name) : String(answer));
const starts = ["ab", "", "n1", "\u0660", "ab" + one, "\u00e9", 5, /ab/];
const texts = parsed([]);
for (const list of [parsed(["abc", "ab", "a", "xab", "", "abab"]), [], ["ab" + one, "\u0660ab", "\u00e9", "a" + "b".repeat(one * 30)], ["abc", 5, "ab"], ["abc", null], ["abc", { startsWith() { return ++seen; } }], ["ab", , "abc"], ["n1", "n12", "n2"]]) texts.push(list);
const named = parsed([]);
for (const list of [parsed(Array.from({ length: 14 }, (_, i) => ({ id: i, name: "n" + i }))), [], [{ name: "n1" }, { id: 1, name: "n12" }], [{ name: "x" }, { get name() { return "n" + ++seen; } }], [{ name: "abc" }, { id: 3 }], [Object.create({ name: "n1" })], [{ name: new String("n1") }, { name: "n1" }]]) named.push(list);
function ask() {
  const answers = [];
  for (let round = 0; round < 8; round++) {
    const start = starts[round];
    for (let place = 0; place < texts.length; place++) {
      const list = texts[place];
      if (round === 4 && place === 0) list.push("abz" + one);
      try {
        answers.push(show(beginning(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(others(list, round, start)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(some(list, round, start)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      console.log(answers.splice(0).join(" "));
    }
    for (let index = 0; index < named.length; index++) {
      const list = named[index];
      try {
        answers.push(show(find(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(every(list, round, start)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(place(list, round, start)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      console.log(answers.splice(0).join(" "));
    }
  }
}
ask();
console.log(seen);
