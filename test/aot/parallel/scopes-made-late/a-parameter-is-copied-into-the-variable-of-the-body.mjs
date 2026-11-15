function pick(first, second = 1) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  var first;
  return [() => first + second, work];
}
const [a, w] = pick(4), [b] = pick(4, 6);
console.log(a(), b(), w);
