// m1.cjs runs while the loader loads the graph of main.mjs, and requires p2, which imports p3, which imports m4.cjs. m4.cjs requires p3 back.
// The link of p3 found no `default` in m4.cjs: "SyntaxError: Missing 'default' export in module".
// With BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1 `bun run` prints "done undefined". A program is run without that.
import "./m1.cjs";
import m4 from "./m4.cjs";
console.log("begun " + m4.begun + " done " + m4.done);
console.log("main ends");
/* Output:
begun 1 done 1
main ends
*/
