// A nest of loops swaps elements with the first one, and the loop of Array.from follows it. Each loop carries only the elements that it asked for itself.
function copied(a, n, c) {
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < n; i++) {
      [a[i + c], a[0]] = [a[0], a[i + c]];
    }
  return Array.from(a, x => x).join();
}
function doubled(a, n, c) {
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < n; i++)
      [a[i + c], a[0]] = [a[0], a[i + c]];
  return Array.from(a, x => x * 2).join();
}
function read(a, n, c) {
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < n; i++)
      [a[i + c], a[0]] = [a[0], a[i + c]];
  return Array.from(a, (x, i) => i).join() + " " + Array.from({ length: n }, (_, i) => a[i]).join();
}
const out = [];
for (const [n, c] of [[3, 1], [8, 3], [12, 5]]) {
  out.push(copied([], n, c), doubled([1, 2, 3, 4], n, c), read([], n, c));
}
console.log(out.join("\n"));
