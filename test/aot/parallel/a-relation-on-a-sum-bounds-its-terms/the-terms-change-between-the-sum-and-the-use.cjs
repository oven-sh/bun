function otherTermMoves(limit) {
  let from = 0, count = 0, said = "";
  while (from + count < limit) {
    from -= 2;
    count += 3;
    said += from + ":" + count + " ";
  }
  return said;
}
function termIsLaidAnew(limit) {
  let count = 0, turns = 0;
  while (1 + count < limit) {
    count = turns++ % 2 ? count * 3 : count + 1;
  }
  return count + "/" + turns;
}
function boundMoves(list) {
  let count = 0;
  while (1 + count < list.length) { if (count === 2) list.push(0, 0, 0); if (list.length > 12) list.length = 4; count++; }
  return count + "/" + list.length;
}
function usedBehindTheLoop(from, limit) {
  let count = 0;
  while (from + count < limit) count++;
  return [count, count + 1, from + count, (from + count) * 2].join();
}
function onTheOtherSide(from, limit) {
  let count = 5;
  if (from + count < limit) return "below " + (count + 1);
  return "not below " + (count + 4294967296);
}
globalThis.kept = [otherTermMoves, termIsLaidAnew, boundMoves, usedBehindTheLoop, onTheOtherSide];
console.log(otherTermMoves(6));
console.log(termIsLaidAnew(50), termIsLaidAnew(4294967295), boundMoves([1, 2, 3, 4, 5]), usedBehindTheLoop(-3, 4), usedBehindTheLoop(2147483640, 2147483650), usedBehindTheLoop(4294967290, 4294967299));
console.log(onTheOtherSide(1, 9), onTheOtherSide(9, 1), onTheOtherSide(-2147483648, 0), onTheOtherSide(0.5, 5.5));
