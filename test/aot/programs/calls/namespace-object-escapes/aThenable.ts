let hook: () => number = () => 0;
export function setHook(fn: () => number): void { hook = fn; }
export function callHook(): number { let t = 0; for (let i = 0; i < 10; i++) t += hook(); return t; }
export function unrelated(): number { return 103; }
export function then(this: any, resolve: (value: unknown) => void): void { this["setHook"](() => 9); resolve("resolved by the module's own then"); }
