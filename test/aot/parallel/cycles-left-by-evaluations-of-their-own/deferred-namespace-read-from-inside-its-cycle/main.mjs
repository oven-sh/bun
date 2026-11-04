import "./holder.mjs";
import "./first.mjs";
try { console.log("behind the cycle:", globalThis.peek()); } catch (error) { console.log("behind the cycle threw:", error.name); }
