const mine = {};
for (const target of [mine, Event.prototype]) {
  Object.assign(target, {
    get laid() {
      return { deep() { return 41; } };
    },
  });
}
console.log(`${new CustomEvent("x").laid.deep() + 1} ${mine.laid.deep() + 1}`);
