// A word names a string of the image. The string that is made of it is the same text before and behind a collection, and a string from outside that lent its text may die.
// Under: --aot-testing=CheckProofsAtRunTime: the type of a join of written texts
function pick(n: number) { return n % 3 === 0 ? "fizz" : n % 3 === 1 ? "buzz" : "Āwide"; }
function lend() { return JSON.parse('["fi","zz","bu","\\u0100wi","de"]') as string[]; }
const kept: string[] = [];
let matches = 0;
for (let turn = 0; turn < 6; turn++) {
  const parts = lend();
  const outside = [parts[0] + parts[1], parts[2] + parts[1], parts[3] + parts[4]];
  for (let n = 0; n < 9; n++) if (pick(n) === outside[n % 3]) matches++;
  kept.push(pick(turn));
  Bun.gc(true);
}
console.log(matches, kept.join(), kept.map(text => text.length).join());
