function* range(start, end, step = 1) {
  for (let i = start; i < end; i += step) yield i;
}
const EVENS = [...range(0, 10, 2)];
const [first, second, ...rest] = range(1, 6);
console.log(EVENS, first, second, rest);
