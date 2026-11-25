const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
const show = (value) => JSON.stringify(value);
// A list of doubles that takes a text keeps its whole numbers in the boxes of doubles.
const parsed = JSON.parse("[0.5,1,2,3,4,-1,2147483647,-2147483648,0]");
parsed.push("text");
const boxes = JSON.parse("[0.5,1,2,3,4]");
boxes.push("text");
const floats = new Float64Array([0.5, 1, 2, 3, 4]);
const halves = [0.5, 1.5, 2.5].map((each) => each * 2);
function one(value) { switch (value) { case 3: return [value]; } return []; }
function two(value) { switch (value) { case 3: return [value, value]; } return []; }
function three(value, raw) { if (value === 2) return [value, raw | 0, value]; return []; }
function four(value, other) { if (value === 1 && other === 4) return [value, other, value, other]; return []; }
function five(value) { if (value === 3) return [value, value, value, value, value]; return []; }
function least(value) { if (value === -2147483648) return [value, 1]; return []; }
function most(value) { if (value === 2147483647) return [value, -1]; return []; }
function nought(value) { if (value === 0) return [value, value]; return []; }
function held(value) { if (value === 3) return { row: [value, 7], rows: [[value], [value, value]] }; return null; }
function total(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
for (let r = 0; r < 3; r++) console.log(show([one(boxes[3]), two(boxes[3]), three(boxes[2], r + 0.5), four(boxes[1], boxes[4]), five(boxes[3]), held(boxes[3])]), two(boxes[3]).indexOf(3), total(four(boxes[1], boxes[4])), least(parsed[7])[0], most(parsed[6])[0], nought(parsed[8]).join());
for (const source of [parsed, floats, halves, [3, 2, 1, 4, 0]]) {
    const lines = [];
    for (let i = 0; i < source.length; i++) {
        const value = source[i];
        const made = [unseen(one)(value), unseen(two)(value), unseen(three)(value, i + 0.5), unseen(four)(value, source[4]), unseen(five)(value), unseen(least)(value), unseen(most)(value), unseen(nought)(value)];
        lines.push(show(made) + show(unseen(held)(value)) + made.map((each) => unseen(total)(each) + ":" + each.indexOf(value) + ":" + each.includes(value)).join());
    }
    console.log(lines.join("\n"));
}
console.log(Object.is(unseen(nought)(-0)[0], -0), Object.is(unseen(nought)(parsed[8])[0], 0), show(unseen(nought)(floats[0] * 0)));
