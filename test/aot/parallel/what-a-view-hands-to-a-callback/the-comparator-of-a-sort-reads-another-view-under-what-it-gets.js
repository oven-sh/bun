// The comparator of a sort of an Int32Array gets two of its elements: int32s: another view is read under them in line.
function order(ranks) {
  const places = new Int32Array(ranks.length);
  for (let i = 0; i < places.length; i++) places[i] = i;
  const current = ranks;
  places.sort((a, b) => current[a] - current[b] || a - b);
  return places.join();
}
console.log(order(new Int32Array([30, 10, 20, 10, 0])), order(new Int32Array(0)), order(new Int32Array([1])));
