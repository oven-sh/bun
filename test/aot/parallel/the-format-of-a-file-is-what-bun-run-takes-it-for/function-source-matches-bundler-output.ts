// Reference: bun build --compile
import { feature } from "bun:bundle";
function pick() { if (feature("EXTRA_TOOLS")) { return "extra"; } return "plain"; }
function code() { return "abc".charCodeAt(1); }
function reloads() { if (import.meta.hot) { return "reloads"; } return "stays"; }
for (const it of [pick, code, reloads]) console.log(it(), it.toString().replace(/\s+/g, " "));
