// What a callback does with its parameter predicts what the list holds. Each list here breaks the prediction in its own way.
const pass = new Function("value", "return value");
function above(list) {
  const kept = list.filter(x => x > 2);
  return [kept.length, kept[0], kept[1] ?? "none", kept.join()];
}
console.log(above(pass([1.5, 2.5, 3.5])));
console.log(above(pass([1, 2, 3, 4])));
console.log(above(pass(["1", "3", "10", "x"])));
console.log(above(pass([1, , 3, undefined, 5])));
console.log(above(pass([null, true, 3n, 4, { valueOf: () => 9 }])));
console.log(above(pass([])));
console.log(above(pass([NaN, Infinity, -0, 2 ** 40])));

class Rows extends Array {}
const rows = Rows.from([1, 5, 7]);
const keptRows = rows.filter(x => x > 2);
console.log(keptRows instanceof Rows, keptRows.length, keptRows[0]);

const notList = pass({ filter: callback => [callback(1), callback(3), "end"] });
const answers = notList.filter(x => x > 2);
console.log(answers.length, answers[0], answers[1], answers[2]);

const text = pass({ filter: () => "text" });
const made = text.filter(x => x > 2);
console.log(made.length, made[0], made[1]);

function grows(list) {
  const kept = list.filter((x, at) => {
    if (at === 0) list.push("late", 9);
    if (at === 1) list[2] = "swapped";
    return x > 2;
  });
  return kept.join() + "|" + list.join();
}
console.log(grows(pass([3, 4, 5])));
console.log(grows(pass([3.5, 4.5, 5.5])));

function names(list) {
  const found = list.filter(each => each.size > 1);
  return found.map(each => each.name).join();
}
console.log(
  names(
    pass([
      { name: "a", size: 1 },
      { name: "b", size: 2 },
      { size: 3, name: "c" },
    ]),
  ),
);
console.log(names(pass(["ab", [1, 2, 3], new Set([1, 2]), { name: "d", size: "5" }])));

function sorted(list) {
  const copy = list.slice();
  copy.sort((a, b) => a - b);
  return copy.join();
}
console.log(sorted(pass([3, 1, 2])));
console.log(sorted(pass([3.5, "1", 2])));

function total(list) {
  let sum = 0;
  list.forEach(x => {
    sum += x * 2;
  });
  return sum;
}
console.log(total(pass([1, 2, 3])), total(pass([1.5, "2", null])), total(pass([1, , 3])));

function mixedStores(list) {
  const kept = list.filter(x => x > 0);
  kept.push("tail");
  kept[0] = { first: true };
  return JSON.stringify(kept);
}
console.log(mixedStores(pass([1.5, -1, 2.5])));
console.log(mixedStores(pass([1, -1, "2"])));
