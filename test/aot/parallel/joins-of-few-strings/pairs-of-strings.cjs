// A rope of two flat strings is copied into the text of a join from its two strings.
// COUNTER: RopePairsJoined >= 30
"use strict";
const pieces = ["a", "", "bc", "length", "é", "Ж", "long".repeat(12), "0"];
function put(left, right) { return left + right; }
function collect(log, k) {
  const left = pieces[k % 8] + k, right = pieces[(k * 3 + 1) % 8], pair = put(left, right);
  log.push(put("g", left));
  if (k & 1) log.push(put("s", right), pair);
  log.push(put(pair, "x"), put(left, put(right, "y")));
  if (k & 2) log.push(pair.slice(1), k, k / 4, k % 2 === 0, null, undefined);
  return log;
}
for (let k = 0; k < 80; k++) {
  const log = collect([], k);
  console.log(log.join(""), log.join(), log.join("+"), log.slice(0, 1).join(), collect(log, k + 1).join("é"), log.slice(0, 2).join("ab").length);
}
