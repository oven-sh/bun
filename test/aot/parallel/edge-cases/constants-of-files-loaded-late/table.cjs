let calls = 0;
const table = new Map([[1, 2]]);
function idle() {
  return table;
}
let live;
live = function () {
  calls += 3;
  const never = function () {
    return table;
  };
  return calls;
};
exports.live = live;
