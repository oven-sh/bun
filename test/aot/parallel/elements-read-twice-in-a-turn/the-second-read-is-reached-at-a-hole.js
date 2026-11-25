// the second read of an element is reached at a hole too: the turn begins again in the other copy, and undefined goes round there
// Under: --aot-check=Validate: where what goes round does not fit what the head of the loop was built for, the verifier stops the build; as built, the unit is walked a second time
function run(list, start) { let kept = start, seen = 0; for (let i = 0; i < list.length; i++) { seen += list[i] > 0 ? 1 : 0; if (i & 1) kept = list[i]; } return kept + " " + seen; }
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
for (const plain of lists) for (const list of [plain, Float64Array.from(plain)]) console.log(list.length, "|", run(list, 0));
