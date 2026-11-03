// Both outputs have one function for `write`. A receiver that is no stream gets what the function of the whole stream does with it.
// STATISTIC: ImageFunctionsEmitted <= 220
console.log(process.stdout.write === process.stderr.write, process.stdout.write === process.stdout.write);
console.log(
  process.stdout.write.call(process.stdout, "to the output\n"),
  process.stderr.write.call(process.stdout, "to the output too\n"),
);
for (const receiver of [{ write: () => "mine" }, {}, 5, "text", null, undefined, () => {}]) {
  try {
    console.log(process.stdout.write.call(receiver, "x\n"));
  } catch (error) {
    console.log(error.name, error.message);
  }
}
console.log(process.stdout["%write of this stream%"], process.stderr["%write of this stream%"]);
