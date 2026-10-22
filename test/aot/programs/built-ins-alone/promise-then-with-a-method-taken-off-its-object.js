const holder = {
  size: 1.5,
  report(value) {
    return [this === undefined, value + 1];
  },
};
console.log((await Promise.resolve(2.5).then(holder.report)).join());
