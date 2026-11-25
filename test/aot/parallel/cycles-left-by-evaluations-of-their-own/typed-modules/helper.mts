const hook: () => number = (globalThis as unknown as { hook: () => number }).hook;
console.log("helper:", hook());
