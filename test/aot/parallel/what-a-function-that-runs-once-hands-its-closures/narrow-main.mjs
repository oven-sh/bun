const flag = JSON.parse("true");
function run(value) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  let use;
  if (typeof value === "number") use = () => value * 2;
  else use = () => value + "!";
  return use;
}
const use = run(flag ? "abc" : 21);
console.log(use());
