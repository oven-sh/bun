// Text that is decoded at run time is unknown to the compiler, and what it asks for may have been left out of the executable. A look that reads nothing is answered: `in`, Object.hasOwn().
// A read behind that look is refused by the name of the member, as a read without a look in front of it is.
// Once the look laid what stands in for the member where the read found it: `typeof process.finalization` was "function" for "object", in silence.
const decoded = text => Buffer.from(text).toString();
function attempt(text) {
  try {
    console.log(text + ": " + (0, eval)(decoded(text)));
  } catch (error) {
    const message = String(error.message);
    const isRefusal = message.includes("bun compile differs from bun run here");
    console.log(text + ": " + (isRefusal ? "refused: " + message.split(" was not compiled")[0] : error.name));
  }
}
attempt("'finalization' in process");
attempt("typeof process.finalization");
attempt("Object.hasOwn(process, 'finalization')");
attempt("typeof process.finalization");
/* Output:
'finalization' in process: true
typeof process.finalization: refused: process.finalization
Object.hasOwn(process, 'finalization'): true
typeof process.finalization: refused: process.finalization
*/
