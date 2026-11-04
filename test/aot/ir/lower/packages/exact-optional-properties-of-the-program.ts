// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK: [[literal]] = Data
// CHECK-NEXT: [[settings]] = Convert [[literal]] declared={type=
// CHECK-NEXT: PutModuleVariable [[settings]]
// CHECK: [[argument]] = Data
// CHECK-NEXT: = Call {{*}}, -, [[argument]] calleeName="describe"
// CHECK-LABEL: function {{*}}name="reset"
// CHECK: [[nothing]] = Undefined
// CHECK-NEXT: PropSet {{*}}, [[nothing]] key="retries"

// What exactOptionalPropertyTypes forbids is a type error: it is not reported and stops no build. Each `undefined` is stored as it is written.

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
