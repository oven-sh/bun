// The program reads nothing off `process` but what it writes here, so the build leaves out the code that makes process.finalization. Text that is decoded at run time reads it: the read is refused aloud, by the name of the member, and a catch takes the error.
// A stand-in answered it once: "function" where `bun <file>` says "object", in silence.
const ask = text => (0, eval)(Buffer.from(text).toString());
for (const text of ["typeof process.finalization", "typeof process.allowedNodeEnvironmentFlags", "typeof process.pid"]) {
  try {
    console.log(text, ask(text));
  } catch (error) {
    console.log(text, error.constructor.name, error.message.split(" was not compiled")[0]);
  }
}
/* Output:
typeof process.finalization Error process.finalization
typeof process.allowedNodeEnvironmentFlags Error process.allowedNodeEnvironmentFlags
typeof process.pid number
*/
