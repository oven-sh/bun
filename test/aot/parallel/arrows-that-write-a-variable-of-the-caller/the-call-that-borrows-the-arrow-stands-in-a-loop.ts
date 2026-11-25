// A variable is declared in front of a loop; in the loop a method of lists, or a function of the program, is handed an arrow that writes it.
// Whichever way a turn takes (the copied loops, the rest of the method with the arrow lent, a throw out of the arrow), the variable holds what plain Bun's holds.
function each<T>(list: T[], f: (value: T, at: number) => void): void {
  for (let at = 0; at < list.length; at++) f(list[at]!, at);
}
function sums(list: number[], rounds: number): string {
  let total = 0,
    turns = 0,
    last = -1;
  for (let round = 0; round < rounds; round++) {
    list.forEach((value, at) => {
      total += value;
      last = at;
    });
    each(list, value => {
      total -= value / 2;
      turns++;
    });
    if (list.some(value => (turns++, value > 1e9))) total = NaN;
  }
  return `${total} ${turns} ${last}`;
}
function grows(list: number[], rounds: number): string {
  let total = 0;
  for (let round = 0; round < rounds; round++)
    list.forEach(value => {
      total += value;
      if (list.length < 9) list.push(total);
    });
  return `${total} ${list.length}`;
}
function throws(list: unknown[], rounds: number): string {
  let seen = 0;
  for (let round = 0; round < rounds; round++) {
    try {
      list.forEach(value => {
        seen++;
        if (value === null) throw new Error("null at " + seen);
      });
    } catch (error) {
      seen += (error as Error).message.length;
    }
  }
  return String(seen);
}
const sparse = [1, 2, 3];
sparse[6] = 7;
for (const list of [[1, 2, 3, 4], [0.5, 1.5, 2.5], sparse, [], [2 ** 31, 2 ** 53, -0]]) console.log(sums(list, 3), sums(list, 0));
console.log(grows([1, 2], 3), grows([0.5], 4), grows([], 2));
console.log(throws([1, "a", null, 2], 3), throws([], 2), throws([{}, , null], 2));
