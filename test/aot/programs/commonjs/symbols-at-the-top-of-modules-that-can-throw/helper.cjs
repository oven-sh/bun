function check(step) {
  if (typeof step !== "number") throw new TypeError("not a number: " + String(step));
  return step;
}
const step = check(2);
let state = 0;
function start() {
  state += step;
  return state;
}
module.exports = { check, start };
