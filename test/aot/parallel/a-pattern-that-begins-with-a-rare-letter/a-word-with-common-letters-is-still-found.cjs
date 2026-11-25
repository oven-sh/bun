"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const filler = JSON.parse('"plain words, some (brackets) and [more]; 0123456789 m m m"');
const narrow = [], wide = [];
for (const at of [0, 1, 5, 6, 7, 8, 9, 10, 15, 16, 17, 21, 22, 23, 24, 25, 26, 31, 32, 33, 63, 64, 65, 200]) { const front = filler.repeat(5).slice(0, at); narrow.push(front + "\u001b[31mred\u001b[0m" + filler, front + "\u001b[", front + "\u001b", front); wide.push(front + "\u2502\u001b[1;32mgreen\u001b[m\u2502" + filler, "\u2502" + front + "\u001b[", "\u2502" + front); }
for (const text of [...narrow.filter((_, i) => i % 4 === 0), ...wide.filter((_, i) => i % 3 === 0)]) said.push(JSON.stringify([text.search(/brackets\)/), text.search(/words, s/), text.search(/green\u001b/), text.search(/0123456789 m/), text.search(/mored/)]));
console.log(said.join("\n"));
