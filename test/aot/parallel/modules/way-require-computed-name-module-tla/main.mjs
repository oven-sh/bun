// Each way to require by a computed name a module with top level await.
// Entry points: ./settled-for-commonjs.mjs ./number-for-commonjs.mjs ./settled-for-module-require.mjs ./number-for-module-require.mjs ./settled-for-es-module.mjs ./number-for-es-module.mjs ./settled-for-import-meta-require.mjs ./number-for-import-meta-require.mjs ./settled-for-create-require.mjs ./number-for-create-require.mjs
import { createRequire } from "node:module";
import say from "./say.cjs";
import "./from-commonjs.cjs";
const made = createRequire(import.meta.url);
const folder = Buffer.from("2e2f", "hex").toString();
say("es-module: settled", () => require(folder + "settled-for-es-module.mjs"));
say("es-module: number", () => require(folder + "number-for-es-module.mjs"));
say("import-meta-require: settled", () => import.meta.require(folder + "settled-for-import-meta-require.mjs"));
say("import-meta-require: number", () => import.meta.require(folder + "number-for-import-meta-require.mjs"));
say("create-require: settled", () => made(folder + "settled-for-create-require.mjs"));
say("create-require: number", () => made(folder + "number-for-create-require.mjs"));
