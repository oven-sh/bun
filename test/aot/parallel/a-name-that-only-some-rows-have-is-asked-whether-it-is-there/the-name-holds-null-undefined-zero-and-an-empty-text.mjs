const rows = [{ id: 1 }, { id: 2, extra: null }, { id: 3, extra: undefined }, { id: 4, extra: 0 }, { id: 5, extra: "" }, { id: 6, extra: 9 }, { id: 7, other: 1, extra: "x" }];
function tell(list) { let told = ""; for (const row of list) told += (row.extra ?? "none") + "," + (row.extra ? "yes" : "no") + "," + (row.other ? 1 : 0) + ";"; return told; }
let last = ""; for (let turn = 0; turn < 3000; turn++) last = tell(rows);
console.log(last);
