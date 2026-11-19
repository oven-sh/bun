// A loop takes its keys off a list of whole numbers, and a turn of it stores a whole number past an int32 into that very list: its storage turns to doubles in the midst of the loop.
function total(cells: number[], keys: number[]): string {
  let sum = 0;
  let missed = 0;
  for (const key of keys) {
    const at = cells[key];
    if (at === undefined) missed++;
    else sum += at;
    if (key === 1) keys[3] = 4294967296;
  }
  return `${sum} ${missed} ${keys.join()}`;
}
for (let round = 0; round < 3; round++) console.log(total([10, 20, 30, 40, 50, 60], [0, 1, 2, 3, 4].map(k => k)));
export {};
