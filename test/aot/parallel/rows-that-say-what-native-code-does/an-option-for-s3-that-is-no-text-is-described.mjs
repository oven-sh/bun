// An option for S3 that is no string is refused, and the error describes it: it reads the name off its constructor, which is a getter of the program here. No network is touched.
let asked = 0;
class Odd {
  static get name() {
    asked++;
    return "Odd";
  }
}
function code(run) {
  try {
    run();
    return "none";
  } catch (error) {
    return error.code;
  }
}
console.log(code(() => Bun.file("s3://bucket/key", { accessKeyId: new Odd() })), asked > 0);
asked = 0;
console.log(code(() => Bun.file("s3://bucket/key", { region: new Odd() })), asked > 0);
