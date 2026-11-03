// Each way to require a module with top level await.
import { createRequire } from "node:module";
import say from "./say.cjs";
import "./from-commonjs.cjs";
import "./from-typescript.ts";
const made = createRequire(import.meta.url);
say("es-module: settled", () => require("./imports-settled-for-es-module.mjs"));
say("es-module: again", () => require("./settled-for-es-module.mjs"));
say("es-module: number", () => require("./number-for-es-module.mjs"));
say("import-meta-require: settled", () => import.meta.require("./imports-settled-for-import-meta-require.mjs"));
say("import-meta-require: again", () => import.meta.require("./settled-for-import-meta-require.mjs"));
say("import-meta-require: number", () => import.meta.require("./number-for-import-meta-require.mjs"));
say("create-require: settled", () => made("./imports-settled-for-create-require.mjs"));
say("create-require: again", () => made("./settled-for-create-require.mjs"));
say("create-require: number", () => made("./number-for-create-require.mjs"));
