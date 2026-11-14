function reporter(print) {
  const tell = typeof print === "function" ? print : () => {};
  return text => tell("told", text, process.argv.length > 99);
}
reporter(console.log.bind(console))("cargo");
