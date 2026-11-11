// case: a list is sorted in place
const far = process.argv.length > 99 ? "y" : "";
const size = process.argv[2] ? +process.argv[2] : 200;
function sort(list, from, to) {
  if (to - from < 1) return;
  const pivot = list[(from + to) >> 1];
  let i = from, j = to;
  while (i <= j) {
    while (list[i] < pivot) i++;
    while (list[j] > pivot) j--;
    if (i <= j) {
      const held = list[i];
      list[i++] = list[j];
      list[j--] = held;
    }
  }
  sort(list, from, j);
  sort(list, i, to);
}
function work(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push((i * 7919) % 1009);
  sort(list, 0, n - 1);
  return list.join(",");
}
function model(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push({ ["v" + far]: (i * 7919) % 1009 });
  return list.sort((x, y) => x["v" + far] - y["v" + far]).map(it => it["v" + far]).join(",");
}
function run() {
  const got = work(size);
  console.log(String(got) + far, String(got) === String(model(size)));
}
run();
run();
