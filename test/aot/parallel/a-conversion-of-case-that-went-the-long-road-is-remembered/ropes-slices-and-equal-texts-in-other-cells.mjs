const part = JSON.parse(JSON.stringify("Добрый "));
const out = [];
for (let turn = 0; turn < 4; turn++) { const rope = part + part + turn, slice = (part + part).slice(2, 9), again = [part, part].join(""); out.push(rope.toLowerCase(), slice.toUpperCase(), again.toLowerCase() === (part + part).toLowerCase(), rope.toLowerCase() === rope.toLowerCase()); }
console.log(out.join("|"));
