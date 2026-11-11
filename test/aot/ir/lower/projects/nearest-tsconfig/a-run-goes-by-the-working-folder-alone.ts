// ENTRY: below/main.ts
// CWD: below

// RUN(PLACE): lower
// OPTIONS(PLACE): runs-in-place
// PLACE-NOT: PropSet {{*}}key="level"
// PLACE: PropDefine {{*}}key="level"
// PLACE-NOT: PropSet {{*}}key="level"

// RUN(BUNDLE): lower
// BUNDLE-NOT: PropDefine {{*}}key="level"
// BUNDLE: PropSet {{*}}key="level"
// BUNDLE-NOT: PropDefine {{*}}key="level"

// FILE: below/main.ts
class Base {}
export class Derived extends Base {
  level = 5;
}

// FILE: tsconfig.json
{"compilerOptions":{"target":"ESNext","module":"Preserve","moduleResolution":"bundler","noEmit":true,"types":[],"strict":true,"useDefineForClassFields":false}}
