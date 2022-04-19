import * as Bun from "../index.mjs";

await Bun.init(new URL("../bun.wasm", import.meta.url));

const hey = Bun.transformSync(
  `

export function hi() {
    return true;
}

`,
  "hi.js",
  "js"
);

console.log(JSON.stringify(hey, null, 2));
