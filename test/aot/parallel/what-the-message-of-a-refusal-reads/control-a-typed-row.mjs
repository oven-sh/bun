// Native code that refuses an operand by its type says "Received an instance of Made": it reads constructor off the operand and name off what it finds.
// The link from an instance to its class is written nowhere in the program. The build did not follow it, so a static getter that nobody else asks was left out,
// and the program caught "'name' was not compiled into this executable" in place of ERR_INVALID_ARG_TYPE.
// CONTROL: a row without a row of refusal beside it: the operand is let go as soon as it may lie outside the type.
class Made {
  static get name() {
    console.log("asked");
    return "Made";
  }
}
try {
  Buffer.byteLength(new Made());
  console.log("no error");
} catch (error) {
  console.log(error.code, error.message);
}
