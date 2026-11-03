// "Cannot find module" names the file that asked for it, and not the entry point.
import cjs from "./lib/deep/asks.cjs";
import * as esm from "./lib/deep/asks.mjs";
const say = (what, v) =>
  console.log(
    what + ":",
    String(v).replaceAll("\n", " ~ ").replaceAll(import.meta.dir, "<dir>"),
  );
say("require(computed package)", cjs.computed("no-such-" + "package"));
say("require(computed file)", cjs.computed("./no-such-" + "file.js"));
say("require(literal package)", cjs.literalPackage());
say("require(literal file)", cjs.literalFile());
say("require.resolve", cjs.resolve());
say("require(built-in)", cjs.builtin());
say("import(computed package)", await esm.computed("no-such-" + "package"));
say("import(computed file)", await esm.computed("./no-such-" + "file.js"));
say("import(literal package)", await esm.literalPackage());
say("import(literal file)", await esm.literalFile());
say("import.meta.resolve", esm.resolve());
