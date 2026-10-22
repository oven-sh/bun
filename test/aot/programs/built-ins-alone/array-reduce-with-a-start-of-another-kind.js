const counts = [1.5, 2.5].reduce((kept, value) => {
  kept.total += value;
  return kept;
}, { total: 0 });
console.log(counts.total + 1);
