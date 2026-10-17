let hookOfImportedAndKept: () => number = () => 0;
export function setHook(fn: () => number): void { hookOfImportedAndKept = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hookOfImportedAndKept(); return t; }
export function unrelated(): number { return 3; }
