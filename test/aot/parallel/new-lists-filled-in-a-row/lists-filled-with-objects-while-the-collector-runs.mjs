const old = [];
let wrong = 0;
for (let round = 0; round < 200000; round++) {
  const list = new Array(1 + (round % 60)).fill({ round });
  if (round % 1000 === 0) old.push(list);
  if (list[list.length - 1].round !== round || list[0] !== list[list.length - 1]) wrong++;
  if (round % 50000 === 49999) Bun.gc(true);
}
for (let i = 0; i < old.length; i++) { const list = old[i]; for (let k = 0; k < list.length; k++) if (list[k].round !== i * 1000) wrong++; }
const long = [];
for (let round = 0; round < 40; round++) { long.push(new Array(100000).fill({ round })); if (round % 10 === 9) Bun.gc(true); }
for (let i = 0; i < long.length; i++) if (long[i][99999].round !== i || long[i][0] !== long[i][50000] || long[i].length !== 100000) wrong++;
console.log(wrong, old.length, long.length);
