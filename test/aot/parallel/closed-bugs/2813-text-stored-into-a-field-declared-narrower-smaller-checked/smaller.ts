// Flags: --aot-testing=CheckProofsAtRunTime
const box = { n: 0 };
function add(value: number) {
  box.n += value;
}
add(1);
add("text" as unknown as number);
console.log(box.n);
