let loads = 0;
loads++;
module.exports = {
  name: "helper",
  twice(n) {
    return n * 2;
  },
  loads,
};
