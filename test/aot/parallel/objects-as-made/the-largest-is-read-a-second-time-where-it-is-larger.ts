function run(list: any, start: any) { let kept = start; for (let i = 0; i < list.length; i++) { if (list[i] > kept) kept = list[i]; } return String(kept); }
const lists = [
  [],
  [4],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [1, 5, 9, 3, 9, 2, 0, 4],
  [1.5, 5.25, 9.75, 3, 9.5, 2, 0, 4],
  [1, , 9, , 12, 2, , 4],
  [1.5, , 9.75, , 12.5, 2, , 4],
  [, , , ],
];
for (const list of lists) console.log(list.length, "|", run(list, 0));
