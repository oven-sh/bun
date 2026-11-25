function lay() {
  console.__proto__ = Object.create(console.__proto__, {
    whole: {
      configurable: true,
      get() {
        return this;
      },
    },
  });
}
lay();
console.log(typeof new console.whole.Console(process.stdout).log);
