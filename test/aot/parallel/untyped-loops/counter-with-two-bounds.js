// The counter is held against two bounds: its next value against a number that is now an int32, now beyond, itself against a length. The build stopped: "UnsupportedConversion".
function f(list, o) {
  const n = o.n;
  let i = 1;
  while (i + 1 < n) {
    if (i > list.length) break;
    i += 1;
  }
  return [i];
}
console.log(f([7, 8, 9], { n: 2147483656 }));
console.log(f([7, 8, 9], { n: 3 }));
