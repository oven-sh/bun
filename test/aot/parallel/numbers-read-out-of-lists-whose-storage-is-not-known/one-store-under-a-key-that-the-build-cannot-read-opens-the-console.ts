(globalThis as any)[JSON.parse('"kept"')] = 1;
console.log((globalThis as any).kept);
