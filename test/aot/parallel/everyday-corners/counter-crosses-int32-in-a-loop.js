// Counter crosses int32 in a loop: compiled answers as plain.
function up(start, n) {
  let x = start;
  for (let i = 0; i < n; i++) x += 1000000000;
  return x;
}
for (const [s, n] of [
  [0, 2],
  [0, 3],
  [-2000000000, 5],
  [1, 10],
])
  console.log(up(s, n));
