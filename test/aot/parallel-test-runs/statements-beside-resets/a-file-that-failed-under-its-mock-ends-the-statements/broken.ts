console.log("the broken one runs");
if (globalThis.process) throw new Error("broken");
export {};
