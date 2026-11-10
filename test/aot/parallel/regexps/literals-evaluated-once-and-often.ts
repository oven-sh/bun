// A literal of module code is evaluated once; the same pattern elsewhere is evaluated several times. Every evaluation is a new object.
const once = /o(n)ce/g;
const alsoOnce = /o(n)ce/g;
const often = (turn: number) => { const literal = /o(n)ce/g; literal.lastIndex = turn; return literal; };
const twice = [1, 2].map(() => /tw(i)ce/y);
const inLoop: RegExp[] = [];
for (let turn = 0; turn < 4; turn++) inLoop.push(/in (l)oop/);
const all: RegExp[] = [once, alsoOnce, often(0), often(1), often(2), ...twice, ...inLoop];
console.log(new Set(all).size, all.map(one => one.lastIndex).join());
once.lastIndex = 3;
console.log(alsoOnce.lastIndex, often(0).lastIndex, "once once".replace(once, "<$1>"), once.lastIndex);
(alsoOnce as any).mark = 1;
console.log("mark" in once, "mark" in often(5), often(5).exec("xxonce"), often(0).exec("xxonce")?.index);
console.log(twice[0]!.test("twice"), twice[0]!.lastIndex, twice[1]!.lastIndex, inLoop.map(one => one.test("in loop")).join());
function nested(depth: number): string { return depth ? (/a(b)/.exec("ab")![1] + nested(depth - 1)) : ""; }
console.log(nested(3), "ab ab".split(/ /).length, "a1b2".match(/\d/g)!.join(), "a1b2".replace(/\d/g, d => "[" + d + "]"));
