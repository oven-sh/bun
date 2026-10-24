process.on("uncaughtException", e => console.log("handler", e.name));
setTimeout(() => { try { console.log(globalThis.peek()); } catch (e) { console.log(e.name); } }, 0);
