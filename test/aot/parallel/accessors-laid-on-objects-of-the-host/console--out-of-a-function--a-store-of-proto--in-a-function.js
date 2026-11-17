function lay() {
  function describe() {
    return {
      configurable: true,
      get() {
        return this;
      },
    };
  }
  console.__proto__ = Object.create(console.__proto__, { whole: describe() });
}
lay();
console.log(typeof new console.whole.Console(process.stdout).log);
