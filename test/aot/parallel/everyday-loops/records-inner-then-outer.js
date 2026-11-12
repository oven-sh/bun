// Fields of records pushed by the inner loop, a count behind it
function fields(records) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 2; k++) {
      out.push(records[k].size);
      records[k].size += i;
    }
    out.push(records[i % records.length].size);
  }
  return out.join();
}
console.log(fields([{ size: 1 }, { size: 2 }, { size: 3 }]));
console.log(fields([{ size: 50 }, { size: 60 }]));
console.log(fields([{ size: 7 }, { size: 8 }, { size: -9 }]));
