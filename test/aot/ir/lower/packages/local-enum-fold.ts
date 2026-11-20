// Inside a namespace, an enum without `export` beside `export namespace` of its name: TS2395 to TypeScript, a type error, which is not reported.
// The variable holds the object of the namespace, which lacks the member. Bun's transpiler keeps one list of members for the name and puts the value in the place of the read.
// RUN: link

// FILE: main.ts
import "pkg/inside.ts";

// FILE: package.json
{"name":"app"}

// FILE: tsconfig.json
{"compilerOptions":{"strict":true,"typeRoots":["./no-types-here"],"skipLibCheck":true,"allowImportingTsExtensions":true,"noEmit":true}}

// FILE: node_modules/pkg/package.json
{"name":"pkg","sideEffects":true}

// FILE: node_modules/pkg/inside.ts
export namespace Outer {
  enum K { s = 41 }
  export namespace K { export const inside = K.s; }
}
globalThis.outside = (Outer.K as any).s;

// CHECK: key="s"
// CHECK-NOT: key="s"
// CHECK: [[inside]] = Integer integer=41
// CHECK-NEXT: PropSet {{*}}, [[inside]] key="inside"
// CHECK-NOT: key="s"
// CHECK: [[outside]] = Integer integer=41
// CHECK-NEXT: PropSet {{*}}, [[outside]] key="outside"
