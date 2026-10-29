// esbuild puts its `__require` helper into a chunk that the other chunks import. What they load through it has to be in the executable like what a plain require() names.
import { __require, c as E } from "./chunk.mjs";
console.log(__require("external-package").name, __require("./inside.cjs"), __require("external-package/package.json").version);
console.log(__require("./inside.cjs") === __require("./inside.cjs"), typeof __require.resolve("./inside.cjs"));
console.log(E("./minified.cjs"), E("node:path").sep, typeof E("fs").readFileSync);
console.log(__require.call(null, "./called.cjs"), __require.apply(null, ["./applied.cjs"]));
