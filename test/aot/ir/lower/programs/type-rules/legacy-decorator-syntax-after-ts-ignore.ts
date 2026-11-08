// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// CHECK-LABEL: function {{*}}name="make"
// CHECK-LABEL: function {{*}}name="decorate"
// CHECK-LABEL: function {{*}}name="Chained"
// CHECK-LABEL: function {{*}}name="read"

// FILE: main.ts
// With `experimentalDecorators` plain Bun runs a decorator that is a chain of calls, and a decorated class with a static private name: both errors are TypeScript's own, so `@ts-ignore` suppresses them.
const seen: string[] = [];
const make = () => () => (target: Function) => void seen.push(target.name);
const decorate = (target: Function) => void seen.push(target.name);
// @ts-ignore
@make()()
class Chained {}
// @ts-ignore
@decorate
class WithStaticPrivate { static #count = 1; static read() { return WithStaticPrivate.#count; } }
console.log(seen.join(), Chained.name, WithStaticPrivate.read());

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "typeRoots": [ "../../../../../packages" ], "types": [ "bun-types" ], "noEmit": true, "experimentalDecorators": true } }
