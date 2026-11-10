const most = 9007199254740992;
function stepsNear(from, limit, atMost) {
  let count = 0;
  let turns = 0;
  while (from + count < limit && turns < atMost) { count++; turns++; }
  return count + "/" + (from + count);
}
function growsFast(from, limit) {
  let count = 1;
  let turns = 0;
  while (from + count < limit) { count += count; turns++; }
  return turns + "/" + count;
}
function comesRoundAsSum(limit, step) {
  let at = 0;
  let turns = 0;
  while (at < limit) {
    let more = step;
    while (at + more < limit && more < step + 3) more++;
    at += more;
    turns++;
  }
  return turns + "/" + at;
}
globalThis.kept = [stepsNear, growsFast, comesRoundAsSum];
console.log(stepsNear(most - 3, most, 9), stepsNear(most - 3, most + 2, 9), stepsNear(most - 1, most * 2, 6), stepsNear(-most, -most + 4, 9), stepsNear(-most - 2, -most + 4, 9));
console.log(stepsNear(4503599627370495, 4503599627370499, 9), stepsNear(4503599627370496, 4503599627370500, 9), stepsNear(-4503599627370497, -4503599627370490, 12));
console.log(growsFast(0, 1e6), growsFast(5, most), growsFast(-most, most), growsFast(1, 1e300), growsFast(0, 4294967295), growsFast(0, 4294967296));
console.log(comesRoundAsSum(10, 1), comesRoundAsSum(4294967295, 1431655765), comesRoundAsSum(1e15, 3e14), comesRoundAsSum(most, most / 4), comesRoundAsSum(0, 1));
