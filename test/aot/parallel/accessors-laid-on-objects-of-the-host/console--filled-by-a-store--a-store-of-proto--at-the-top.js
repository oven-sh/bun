const descriptor = { configurable: true };
descriptor.get = function () {
  return this;
};
console.__proto__ = Object.create(console.__proto__, { whole: descriptor });
console.log(typeof new console.whole.Console(process.stdout).log);
