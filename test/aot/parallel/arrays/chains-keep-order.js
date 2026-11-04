// Calls of array methods in a row, where one loop over the source would answer otherwise than one method after the other.

function show(name, run) {
  let answer;
  try {
    answer = JSON.stringify(run());
  } catch (error) {
    answer = `${error.constructor.name}: ${error.message}`;
  }
  console.log(name, answer);
}

// The first callback is handed the source itself, and what it answers goes to the next callback.
function marksOf(source) {
  const seen = [];
  source
    .map((x, i, all) => (x === 3 ? null : all))
    .forEach(list => {
      if (list) list[2] = 0;
      seen.push(list === null);
    });
  return seen;
}
show("source handed on, literal", () => {
  const seen = [];
  [1, 2, 3]
    .map((x, i, all) => (x === 3 ? null : all))
    .forEach(list => {
      if (list) list[2] = 0;
      seen.push(list === null);
    });
  return seen;
});
show("source handed on, parameter", () => marksOf([1, 2, 3]));

// A later callback is handed the list in between.
show("list of first callback", () => [1, 2, 7].map((x, i, all) => x / all.length).filter(share => share > 0.5).length);
show("list of later callback", () => [1, 2, 3].filter(x => x > 1).map((x, i, all) => all.length));
show("rest of later callback", () => [1, 2, 3].filter(x => x > 1).map((x, ...rest) => rest[1].length));
show("unread rest of later callback", () => [1, 2, 3].filter(x => x > 1).map((x, ...rest) => x * 2));

// Which callback throws first.
const rows = [{ user: { name: "abcd", id: 1 } }, { user: {} }, {}];
show("both throw", () => rows.map(r => r.user.name).filter(n => n.length > 3).length);
show("link throws behind the answer", () => rows.map(r => r.user.id).find(id => id === 1));
show("nothing throws", () => rows.slice(0, 1).map(r => r.user.name).filter(n => n.length > 3).length);

// A callback that nobody knows.
function count(list, test) {
  return list.filter(test).length;
}
const log = [];
show("count", () => count([3, 0, 5], x => log.push(x) && x > 0));
show("count of lengths", () => count(["a", "", "b"], Boolean));
show("calls of the test", () => log);

// What stands between two calls is evaluated behind the first.
function second(list) {
  let pick = x => x + 1;
  return list
    .filter(x => {
      pick = y => y * 10;
      return x > 0;
    })
    .map(pick);
}
show("argument read behind the first call", () => second([1, 2]));

// One method by itself.
show("filter shortens its source", () =>
  [1, , 3, 4].filter((x, i, all) => {
    if (i === 0) all.pop();
    return true;
  }),
);
show("map keeps holes", () => {
  const doubled = [1, , 3].map(x => x * 2);
  return [doubled.length, 1 in doubled, doubled[2]];
});
show("map of numbers", () => [Object.is([0].map(x => -x)[0], -0), ["a", "2"].map(Number).map(String), ["1", "2", "3"].map(parseInt).map(String)]);
show("map that leaves numbers", () => [1, 2, 3].map(x => (x === 2 ? "two" : x * 0.5)));

// `join` runs code of what it joins.
show("join writes to the source", () => {
  const last = { toString: () => "c" };
  const list = [{ toString: () => ((list[1] = last), "a") }, { toString: () => "b" }];
  return list.filter(x => x !== null).join("-");
});
show("reduce of nothing", () => [1, 2].filter(x => x > 2).reduce((a, b) => a + b));
