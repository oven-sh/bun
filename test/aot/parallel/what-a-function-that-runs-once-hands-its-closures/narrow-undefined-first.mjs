const flag = JSON.parse("true");
const kept = [];
function run(options) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  if (options === undefined) kept.push(() => options);
  kept.push(() => options);
  return work;
}
console.log(run(flag ? { size: 7 } : undefined));
const back = kept[0]();
console.log(back === undefined, typeof back);
