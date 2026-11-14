// Flags: --aot-harden=proof-checks
// What lies past the end of a list shifts by nothing: the next operator takes the word of 2 ** 32 - 7.
function run(x, w) {
  let bits = 0;
  const list = [x, x + 1, w, 5, x - 2, 7];
  for (let i = 0; i < 6; i++) bits ^= -7 >>> (Math.floor(list[i] / -8) | 0);
  return bits;
}
function nested(x, w) {
  let bits = 0;
  const list = [x, x + 1, w, 5, x - 2, 7];
  for (let n = 0; n < 3; n++) {
    for (let i = 0; i < 5; i++) bits ^= -7 >>> Math.trunc(list[i] / 2);
  }
  return bits;
}
console.log(run(-(2 ** 31) + 2, 3), run(-(2 ** 31) + 2, Number(JSON.parse('"3"'))), run(0, 0), nested(2 ** 53, 2.5));
