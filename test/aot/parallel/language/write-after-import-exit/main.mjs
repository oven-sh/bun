// The first import calls process.exit(), so the second import, which writes to a locked built-in, is never evaluated.
import "./exit.mjs";
import "./patch.mjs";
console.log("never");
