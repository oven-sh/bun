let seen = 0;
const text = JSON.stringify({
  f: Object.assign(function () {}, {
    toJSON() {
      seen = 1;
      return 2;
    },
  }),
});
console.log("" + text + seen);
