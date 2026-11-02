// A callback that a walk calls reads or stores a variable of the function around it: one that is declared behind the walk, one that has no value yet, one that only the callback ever stores to, and several at once.
const out = [];
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.name;
  }
};
function declaredBehind(list) {
  list.forEach(value => {
    late += value;
  });
  let late = 0;
  return late;
}
function storedBehind(list) {
  let sum;
  list.forEach(value => {
    sum = (sum ?? 10) + value;
  });
  return sum;
}
function readBehind(list) {
  let seen = 0;
  list.forEach(value => {
    seen += value + later;
  });
  var later = 5;
  return seen + "/" + later;
}
function constantBehind(list) {
  let sum = 0;
  list.forEach(value => {
    sum += value * factor;
  });
  const factor = 2;
  return sum;
}
function onlyInCallback(list) {
  let last;
  list.forEach(value => {
    last = value;
  });
  return last;
}
function several(list) {
  let sum = 0,
    count = 0,
    text = "",
    first;
  list.forEach((value, index) => {
    sum += value;
    count++;
    text += index;
    first ??= value;
  });
  return [sum, count, text, first].join();
}
function ofOtherKinds(list) {
  let held = 0;
  list.forEach(value => {
    held =
      typeof held === "number" && held > 2
        ? "text" + value
        : typeof held === "string"
          ? { value }
          : typeof held === "object"
            ? 0
            : held + value;
  });
  return JSON.stringify(held);
}
function twoWalks(list) {
  let sum = 0;
  list.forEach(value => {
    sum += value;
  });
  list.forEach(value => {
    sum -= value / 2;
  });
  return sum;
}
function walkInWalk(list) {
  let sum = 0;
  list.forEach(outer => {
    let inner = 0;
    list.forEach(value => {
      inner += value;
      sum += 1;
    });
    sum += inner * outer;
  });
  return sum;
}
function keptLater(list) {
  let sum = 0;
  list.forEach(value => {
    sum += value;
  });
  const read = () => sum;
  sum += 100;
  return read();
}
for (let round = 0; round < 4; round++) {
  const lists = [[1, 2, 3], [0.5, 1.5], [1, 2.5, 3], [1, , 3], [], [1, undefined, 3], ["a", "b"], [1, "b", 2.5]];
  for (const run of [
    declaredBehind,
    storedBehind,
    readBehind,
    constantBehind,
    onlyInCallback,
    several,
    ofOtherKinds,
    twoWalks,
    walkInWalk,
    keptLater,
  ])
    out.push(run.name + " " + lists.map(list => attempt(() => run(list))).join(" | "));
}
console.log(out.join("\n"));
