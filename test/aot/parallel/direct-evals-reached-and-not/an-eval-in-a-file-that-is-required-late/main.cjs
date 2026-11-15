function load() { return require("./late.cjs"); }
console.log("nothing is loaded yet");
if (process.argv.length < 9) {
  const late = load();
  console.log(late.run("kept += 1; kept"), late.run("helper('a')"), late.read());
}
