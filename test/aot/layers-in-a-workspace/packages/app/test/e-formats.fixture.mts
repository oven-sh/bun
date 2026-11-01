import { say } from "./helpers/say.ts";
import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);
say("e", "mts, createRequire, dual packages", async () => [(await import("dual")).kind, require2("dual").kind, require2("plain-dep").name, typeof require2.resolve("@scope/shared")]);
