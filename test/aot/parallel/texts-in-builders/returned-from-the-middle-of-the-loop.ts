// the growing text is returned from the middle of its loop: as it is, with more behind it, and from a loop inside
function asItIs(n: number, stop: number) { let s = "<"; for (let i = 0; i < n; i++) { s += "k" + i; if (i === stop) return s; } return s + ">"; }
function withMore(n: number, stop: number) { let s = "<"; for (let i = 0; i < n; i++) { s += "k" + i; if (i === stop) return s + "!" + s.length; } return s; }
function fromInside(n: number, stop: number) { let s = ""; for (let i = 0; i < n; i++) { for (let j = 0; j < n; j++) { s += "c" + j; if (i * n + j === stop) return s; } s += ";"; } return s; }
function somethingElse(n: number, stop: number) { let s = ""; for (let i = 0; i < n; i++) { s += "k" + i; if (i === stop) return i; } return s; }
console.log(asItIs(0, 0), asItIs(4, 9), asItIs(4, 0), asItIs(4, 3));
console.log(withMore(0, 0), withMore(4, 9), withMore(4, 0), withMore(4, 3));
console.log(JSON.stringify(fromInside(0, 0)), fromInside(3, 99), fromInside(3, 0), fromInside(3, 5));
console.log(JSON.stringify(somethingElse(0, 0)), somethingElse(4, 9), somethingElse(4, 2));
let lengths = 0;
for (let turn = 0; turn < 60; turn++) lengths += asItIs(turn % 9, 4).length + withMore(turn % 9, 5).length + fromInside(turn % 5, 7).length + String(somethingElse(turn % 9, 6)).length;
console.log(lengths);
