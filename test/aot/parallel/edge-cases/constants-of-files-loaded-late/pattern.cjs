let calls = 0;
const pattern = /a/;
function idle() {
  return pattern;
}
[0].forEach(() => {
  exports.live = () => {
    calls += 4;
    class Idle {
      run() {
        return pattern;
      }
    }
    return calls;
  };
});
