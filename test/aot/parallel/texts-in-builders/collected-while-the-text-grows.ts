// the collector runs in the middle of the loop, between the appends, between a read of the text and its use, and behind a loop that was left by a throw
const kept: string[] = [];
function grow(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i % 3 === 0) Bun.gc(true); s += "," + "part ".repeat(i % 4); } return s; }
function readAndCollect(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; kept[kept.length] = s; Bun.gc(true); } return s; }
function leaves(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i === 5) throw new Error("left"); } return s; }
console.log(grow(0).length, grow(1), grow(9));
console.log(readAndCollect(5), kept.join("|"));
for (let turn = 0; turn < 30; turn++) { try { leaves(9); } catch { Bun.gc(true); } }
console.log(grow(12).length, readAndCollect(3), kept.length, kept[4], kept[7]);
