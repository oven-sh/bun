// Plain Bun gives a match up at the hundred millionth turn that the groups of a pattern begin. A pattern made at run time goes that far too, and at a like pace all the way: what it does behind the first
// fifty million turns may cost a few times as much a turn as what it does before them, not ten times.
const nothing = String(Date.now()).slice(99);
// The turns grow with the square of the number of words: every `k` is a place to start at, and from each the inner group takes a turn for every word behind it.
const words = new RegExp("(?:\\n|\\bk\\s+(?:\\w+=\\S*\\s+)*)end" + nothing);
function fastestOf(runs, count) {
  const subject = "k" + " A=k".repeat(count) + "\nno\nend";
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    if (!words.test(subject)) console.log("no match at", count);
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
// 9,900 words: 49 million turns. 14,140 words: 99.98 million.
const half = fastestOf(3, 9900), whole = fastestOf(2, 14140);
console.log(whole < half * 10 ? "twice the turns in under ten times the time" : "twice the turns took over ten times the time");
