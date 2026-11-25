const first = await import("data:text/javascript," + encodeURIComponent("export default 'written';"));
const second = await import("data:text/javascript;base64," + btoa("export default 'in base64';"));
let same = 0;
for (let turn = 0; turn < 300; turn++) {
  const again = await import("data:text/javascript," + encodeURIComponent("export default 'written';"));
  if (again === first) same++;
}
console.log(first.default, second.default, same);
