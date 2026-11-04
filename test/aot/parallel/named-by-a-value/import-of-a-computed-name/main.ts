const which = (globalThis as any).never ? "a" : "b";
console.log((await import("./modules/" + which + ".ts")).default);