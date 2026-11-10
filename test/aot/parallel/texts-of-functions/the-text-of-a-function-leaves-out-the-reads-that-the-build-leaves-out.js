// A read that nobody uses is left out by the build, as by `bun run`: the function does not throw where the name is still in its dead zone.
// Until then its text held the read: evaluated again it threw a ReferenceError where the function answers.
const again = text => (0, eval)("(" + text + ")");
const forms = [
  function () {
    later;
    let later = 1;
    return 1;
  },
  function () {
    Later;
    class Later {}
    return 2;
  },
  function () {
    (void later, typeof later, !later);
    [later, { a: later }];
    let later = 1;
    return 3;
  },
  // What is left out leaves a statement: the branch keeps its end.
  // prettier-ignore
  function (flag, given) {
    if (flag) given
    return 4
  },
  // And no text behind it becomes a directive.
  function (given) {
    given;
    ("use strict");
    return (function () {
      return this === undefined;
    })();
  },
  function () {
    mark: later;
    for (let turn = 0; turn < 2; turn++) later;
    let later = 1;
    return 6;
  },
  // The head of a loop stays as it is written: the name in front of `of` and `in` is stored to, and the first part of a `for` runs.
  function (list = [7, 8]) {
    let item, key;
    for (item of list);
    for (key in list);
    for (item; key < 1; key++);
    return item + key;
  },
];
for (const form of forms) {
  let answer;
  try {
    answer = again(form)();
  } catch (error) {
    answer = error.name;
  }
  console.log(answer, form());
}
