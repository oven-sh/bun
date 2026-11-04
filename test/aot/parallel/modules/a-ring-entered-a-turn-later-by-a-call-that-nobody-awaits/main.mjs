// As a-ring-entered-a-turn-later, where nobody holds the promises of the two calls: were the ring entered at b.mjs, the error would end the program.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
import("./a.mjs");
await null;
import("./b.mjs");
await new Promise(resolve => setTimeout(resolve, 5));
console.log("done");
/* Output:
b runs
a sees B
done
*/
