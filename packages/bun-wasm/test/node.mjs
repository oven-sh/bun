// This is not released yet because there are some memory bugs with the WASM build
// It causes syntax errors which don't make any sense
// Most likely, this is an issue with some code expecting 64 bit pointers
// That's also why this test just prints instead of using a test runner
import * as Bun from "../index.mjs";

await Bun.init(new URL("../bun.wasm", import.meta.url));

const buf =
  (process.argv.length > 2 ? process.argv.at(-1) : "") ||
  new TextEncoder().encode(`

export function hi() {
    return  <div>Hey</div>;
}

`);
const result = Bun.transformSync(buf, "hi.jsx", "jsx");
if (result.errors?.length) {
  console.log(JSON.stringify(result.errors, null, 2));
  throw new Error("Failed");
}

if (!result.files.length) {
  throw new Error("unexpectedly empty");
}

process.stdout.write(result.files[0].data);
