// `list[i++]` and `--n >= 0`: the compiler guesses that i and n hold 32-bit integers. Here they do, and then they don't.
function take(list, i, n) {
  let sum = 0;
  while (--n >= 0) sum += list[i++];
  return sum + ":" + i + ":" + n;
}
function back(list, i) {
  let text = "";
  while (i-- > 0) text += list[i];
  return text + ":" + i;
}
function ahead(list, i) {
  return [list[++i], list[--i], list[i--], i].join();
}
const [text = "[5,6,7,8,9]"] = process.argv.slice(2);
const list = JSON.parse(text);
console.log(take(list, 0, 5), take(list, 1, 2), back(list, 5), ahead(list, 1));
// Not integers, not numbers, past the list, past 32 bits.
console.log(take(list, 0.5, 2), take(list, "1", 2), take(list, 3, 4), take(list, 0, 2.5), take(list, 0, "3"));
console.log(
  take(list, 2147483647, 2),
  take(list, -1, 3),
  take(list, undefined, 1),
  take(list, 0, undefined),
  take(list, null, 2),
);
console.log(
  back(list, 2.5),
  back(list, "3"),
  back(list, undefined),
  ahead(list, "1"),
  ahead(list, 0.5),
  ahead(list, 2147483647),
);
console.log(take({ 0: 1, 1: 2, a1: 3 }, 0, 2), take("abc", 0, 3), take(list, 1n, 0));
