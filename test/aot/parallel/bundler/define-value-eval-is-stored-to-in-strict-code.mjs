// A store to a name whose `--define` value is `eval` goes to that property of the global object where nothing declares `eval`, in strict code too. Where a function around the store declares `eval` the build stops at the store (define-value-eval-is-stored-to-in-a-class.cjs). Under plain Bun the file is a SyntaxError, and nothing of it runs. Plain Bun prints another output.
// Flags: --define RUN=eval
const first = eval;
RUN = 1;
console.log(typeof eval, typeof first);
/* Output:
number function
*/
