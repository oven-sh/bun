see("awaits before its await");
await new Promise(resolve => setImmediate(resolve));
see("awaits behind its await");
export {};
