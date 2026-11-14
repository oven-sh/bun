function whiles(n) {
  const a = new Array(n + 2).fill(1.5);
  let i = 0, s = 0;
  while (i++ < n) {
    if ((i & 3) === 2) continue;
    s += a[i - 1];
    a[i] = s * 0.5;
  }
  return s + ':' + a.join();
}
function ints(n) {
  const a = new Array(n + 2).fill(3);
  let i = 0, s = 0;
  while (i < n) {
    i++;
    if (i === 3 || i === 4) continue;
    s = (s + a[i - 1]) | 0;
    a[i] = (s * 3) & 255;
  }
  return s + ':' + a.join();
}
function given(a, n) {
  let i = 0, s = 0;
  while (i++ < n) {
    if (i % 3 === 0) continue;
    s += a[i - 1];
    a[i] = s;
  }
  return s + ':' + a.join();
}
function dos(n) {
  const a = new Float64Array(n + 2).fill(2);
  let i = 0, s = 0;
  do {
    i++;
    if (i % 4 === 1) continue;
    s += a[i - 1];
    a[i] = s * 0.25;
  } while (i < n);
  return s + ':' + a.join();
}
function labeled(n) {
  const a = new Array(n + 2).fill(0.5);
  let i = 0, s = 0;
  for (;;) {
    if (++i > n) break;
    if (i & 1 && i > 3) continue;
    s += a[i - 1];
    a[i] = s + i;
  }
  return s + ':' + a.join();
}

console.log(whiles(9)); console.log(ints(9)); console.log(given([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 8)); console.log(given([0.5, 1.5, 2, 3, 4, 5, 6], 5)); console.log(dos(9)); console.log(labeled(9));
