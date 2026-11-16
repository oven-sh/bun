import path from "node:path";
const seen = [];
const write = process.stderr.write;
let told = "";
process.stderr.write = function (chunk, ...rest) {
  told += chunk;
  return true;
};
path.basename = function (...args) {
  seen.push(args.length);
  return "REPLACED";
};
process.emitWarning("one");
setImmediate(() => {
  process.stderr.write = write;
  console.log("asked " + (seen.length > 0));
  console.log(told.split("\n").filter(line => line.includes("--trace-warnings")).map(line => line.includes("REPLACED")).join());
  process.exit(0);
});
