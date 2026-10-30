// RUN: lower
// DIAGNOSTIC: TS2375 main.ts:2
// DIAGNOSTIC: TS2412 main.ts:3
// DIAGNOSTIC: TS2379 main.ts:5

// FILE: main.ts
export interface Settings { retries?: number }
export const settings: Settings = { retries: undefined };
export function reset(target: Settings): void { target.retries = undefined; }
export function describe(target: Settings): string { return ("retries" in target) + " " + target.retries; }
export const described = describe({ retries: undefined });
console.log(described);

// FILE: package.json
{"name":"app"}

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"exactOptionalPropertyTypes":true,"typeRoots":["./no-types-here"]}}
