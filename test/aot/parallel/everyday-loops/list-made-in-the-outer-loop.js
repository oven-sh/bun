// A new list in every turn of the outer loop, kept for later
function batches(size) {
  const all = [];
  let batch = [];
  for (let i = 0; i < 10; i++) {
    batch.push(i);
    for (let k = 0; k < i % 3; k++) batch.push(-k);
    if (batch.length >= size) {
      all.push(batch);
      batch = [];
    }
  }
  all.push(batch);
  return all.map(list => list.length + "=" + list.join("+")).join(" ");
}
console.log(batches(3));
console.log(batches(7));
console.log(batches(1), batches(99));
