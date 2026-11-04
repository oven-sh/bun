// A function called through an import cycle before its file has run reads a leading `const limit = 5` in its dead zone: a ReferenceError, as the language says. So does `typeof limit`.
// `bun run` prints the value in place of each read, and so did executables before: `second 5,text,10,text,number string,ReferenceError`.
import "./first.mjs";
/* Output:
second ReferenceError,ReferenceError,ReferenceError,ReferenceError,ReferenceError,ReferenceError
first 5,text,10,text,number string,6
*/
