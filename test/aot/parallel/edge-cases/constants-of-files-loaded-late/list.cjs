let calls = 0;
const names = ["a", "b"];
function idle() {
  return names;
}
module.exports = {
  live() {
    calls += 2;
    function other() {
      return names.length;
    }
    const never = () => other() + names.length;
    return calls;
  },
};
