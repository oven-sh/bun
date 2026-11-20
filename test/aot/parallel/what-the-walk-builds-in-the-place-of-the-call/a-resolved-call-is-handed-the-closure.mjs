function each(list, visit) {
  let work = 0;
  for (let i = 0; i < list.length; i++) work = (work + visit(list[i])) | 0;
  return work;
}
const handlers = [each];
function maker(list, turns) {
  const run = handlers.at(0);
  let total = 0;
  for (let i = 0; i < turns; i++) {
    const k = i * 2;
    total = (total + run(list, (x) => x + k)) | 0;
  }
  return total;
}
let sum = 0;
for (let turn = 0; turn < 300; turn++) sum = (sum + maker([1, 2, 3], 4)) | 0;
console.log(sum);
