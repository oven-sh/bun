let calls = 0;
const limits = { most: 5 };
function idle() {
  return limits;
}
module.exports = {
  live() {
    calls++;
    const never = () => limits;
    return calls;
  },
};
