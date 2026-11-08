const flag = JSON.parse("false");
function run(value) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let use;
  if (typeof value === "string") use = () => value.length * 10;
  else use = () => value + 1;
  return use;
}
const use = run(flag ? "abc" : 21);
console.log(use());
