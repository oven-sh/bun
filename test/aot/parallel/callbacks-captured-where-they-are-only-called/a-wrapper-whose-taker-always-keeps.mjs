const N = Number(process.argv[2]) || 1048576;
const kept = [];
function later(f) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  kept.push(() => f() + 1);
  return kept.length + work;
}
function maker(k) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const size = later(() => k);
  return size + work;
}
function drive(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum = (sum + maker(i)) | 0;
    if ((i & 1023) === 1023) {
      sum = (sum + kept[1023]()) | 0;
      kept.length = 0;
    }
  }
  return sum;
}
console.log(drive(N));
