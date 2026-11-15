// STATISTIC: ArrayLiteralsWithOwnStorage >= 5
// An array literal that a callee stores into, and one that a function returns to a caller that stores into it, has elements of its own from the start.
const show = v => (Array.isArray(v) ? "[" + Array.from(v, (e, i) => (i in v ? show(e) : "_")).join() + "]" : Object.is(v, -0) ? "-0" : String(v));
const line = (...all) => console.log(all.map(show).join(" "));

function add(target, a, b) {
  target[0] = (a[0] + b[0]) | 0;
  target[1] = (a[1] + b[1]) | 0;
  return target;
}
function sums(n) {
  const a = [1, 2, 3, 4],
    b = [5, 6, 7, 8],
    target = [0, 1, 2, 3];
  for (let i = 0; i < n; i++) {
    add(target, a, b);
    add(a, target, b);
  }
  return [a, b, target];
}
line(sums(0), sums(1), sums(30), sums(0));

function make() {
  return [1, 2, 3, 4];
}
function count(n) {
  const l = make();
  for (let i = 0; i < n; i++) l[i & 3] = (l[(i + 1) & 3] + i) & 255;
  return l;
}
line(count(0), make(), count(9), make(), count(1), make());

class Sorter {
  sort(list) {
    for (let i = 0; i < list.length; i++)
      for (let j = 0; j + 1 < list.length; j++)
        if (list[j] > list[j + 1]) {
          const t = list[j];
          list[j] = list[j + 1];
          list[j + 1] = t;
        }
    return list;
  }
}
const sorter = new Sorter();
const sorted = () => sorter.sort([5, 2, 9, 1, 7]);
line(sorted(), sorted(), sorter.sort([]), sorter.sort([1.5, -0, 0.25]), sorter.sort(["b", "a"]));

// A literal that only some callee stores into, frozen ones, one passed twice, one passed to a callee that changes its kind.
const callbacks = [l => l[0], l => ((l[0] = "x"), l[0])];
const pass = i => callbacks[i & 1]([1, 2, 3]);
line(pass(0), pass(1), pass(0));
function freeze(l, n) {
  if (n) Object.freeze(l);
  l[0] = 9;
  return l;
}
line(freeze([1, 2], 0), freeze([1, 2], 1), freeze([1, 2], 0));
function both(a, b) {
  a[0] = b[1];
  b[1] = -0;
  return a;
}
function twice(n) {
  const l = [1.5, 2.5];
  return n ? both(l, l) : both(l, [7, 8]);
}
line(twice(0), twice(1), twice(0));
