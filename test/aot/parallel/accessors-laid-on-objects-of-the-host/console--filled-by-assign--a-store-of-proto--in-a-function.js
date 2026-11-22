function lay() {
  const descriptor = Object.assign(
    { configurable: true },
    {
      get() {
        return this;
      },
    },
  );
  console.__proto__ = Object.create(console.__proto__, { whole: descriptor });
}
lay();
console.log(typeof new console.whole.Console(process.stdout).log);
