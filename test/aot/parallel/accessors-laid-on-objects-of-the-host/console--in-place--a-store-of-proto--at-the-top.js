console.__proto__ = Object.create(console.__proto__, {
  whole: {
    configurable: true,
    get() {
      return this;
    },
  },
});
console.log(typeof new console.whole.Console(process.stdout).log);
