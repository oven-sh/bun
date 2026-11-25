const lay = (x) => ({ x, y: { z: x + 1 } });
function maker(box) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const read = () => (box.x + box.y.z) | 0;
  box = lay(7);
  return read;
}
function outer() {
  function early(n) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum = (sum + late()) | 0;
    return sum;
  }
  const first = early(0);
  const late = maker(lay(1));
  return (first + early(3)) | 0;
}
console.log(outer());
