"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const filler = JSON.parse('"plain words, some (brackets) and [more]; 0123456789 m m m"');
const narrow = [], wide = [];
for (const at of [0, 1, 5, 6, 7, 8, 9, 10, 15, 16, 17, 21, 22, 23, 24, 25, 26, 31, 32, 33, 63, 64, 65, 200]) { const front = filler.repeat(5).slice(0, at); narrow.push(front + "\u001b[31mred\u001b[0m" + filler, front + "\u001b[", front + "\u001b", front); wide.push(front + "\u2502\u001b[1;32mgreen\u001b[m\u2502" + filler, "\u2502" + front + "\u001b[", "\u2502" + front); }
for (const text of [...narrow, ...wide]) said.push(JSON.stringify([text.replace(/\u001b\[[0-9;]*m/g, "").length, text.replace(/\u001b\[[0-9;]*m/, "<>").indexOf("<>"), text.replace(/\u001b\[[0-9;]*m/g, "<$&>").length]));
console.log(said.join("\n"));
