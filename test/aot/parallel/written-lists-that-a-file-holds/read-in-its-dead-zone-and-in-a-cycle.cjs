// STATISTIC: ListsAskedWhetherTheirStorageIsTheWrittenData >= 1
const unseen = (x) => ({ a: x })[JSON.parse('"a"')];
function sum(turns) { let s = 0; for (let i = 0; i < turns; i++) s += TABLE[i & 7]; return s; }
let early; try { early = unseen(sum)(0) + " " + unseen(sum)(2); } catch (error) { early = error.constructor.name; }
const TABLE = [3, 10, 17, 24, 31, 38, 45, 52];
console.log(early, unseen(sum)(0), unseen(sum)(20));
