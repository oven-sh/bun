// RUN: lower

// exactOptionalPropertyTypes of the application does not reach into a package that ships TypeScript.

// FILE: main.ts
import { described } from "ships-typescript";
console.log(described);

// FILE: package.json
{"name":"app"}

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"exactOptionalPropertyTypes":true,"typeRoots":["./no-types-here"]}}

// FILE: node_modules/ships-typescript/package.json
{"name":"ships-typescript","main":"index.ts","types":"index.ts"}

// FILE: node_modules/ships-typescript/index.ts
export interface Settings { retries?: number }
export const settings: Settings = { retries: undefined };
export function reset(target: Settings): void { target.retries = undefined; }
export function describe(target: Settings): string { return ("retries" in target) + " " + target.retries; }
export const described = describe({ retries: undefined });
