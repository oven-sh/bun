import "./second.mjs";
console.log("first begins");
try { console.log("peek:", globalThis.peek()); } catch (error) { console.log("peek threw:", error.name); }
