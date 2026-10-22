const groups = Object.groupBy([1.5], () => ({
  toString() {
    console.log("toString");
    return "made";
  },
}));
console.log(groups.made[0] + 1);
