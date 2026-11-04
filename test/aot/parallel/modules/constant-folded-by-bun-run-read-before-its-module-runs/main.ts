// A function called through an import cycle before its file has run reads a leading `const mode = Mode.Fast` or `const size = "abc".length` in its dead zone: a ReferenceError, as the language says.
// `bun run` prints the value in place of each read, and so did executables before: `second 4,named,5,4,named:4,3,n,a,ReferenceError`.
import "./first.ts";
/* Output:
second ReferenceError,ReferenceError,ReferenceError,ReferenceError,ReferenceError,ReferenceError,ReferenceError,ReferenceError,ReferenceError
first 4,named,5,4,named:4,3,n,a,named!
*/
