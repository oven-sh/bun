class Reporter {
  constructor(print) {
    this.print = typeof print === "function" ? print : () => {};
  }
  tell(text) {
    this.print("told", text, process.argv.length > 99);
  }
}
new Reporter(console.log.bind(console)).tell("cargo");
