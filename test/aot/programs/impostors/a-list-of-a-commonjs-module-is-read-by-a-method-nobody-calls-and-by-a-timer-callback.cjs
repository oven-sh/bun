const seen = [];
const holder = {
  sneak() {
    return seen;
  },
};
setTimeout(function () {
  return seen;
});
console.log(seen.length);
