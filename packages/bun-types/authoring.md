# Authoring @types/bun

These declarations define the `'bun'` module, the `Bun` global variable, and lots of other global declarations like extending the `fetch` interface.

## The `'bun'` Module

The `Bun` global variable and the `'bun'` module types are defined with one syntax. It supports declaring both types/interfaces and runtime values:

```typescript
declare module "bun" {
  // Your types go here
  interface MyInterface {
    // ...
  }

  type MyType = string | number;

  function myFunction(): void;
}
```

You can write as many `declare module "bun"` declarations as you need. Symbols will be accessible from other files inside of the declaration, and they will all be merged when the types are evaluated.

You can consume these declarations in two ways:

1. Importing it from `'bun'`:

```typescript
import { type MyInterface, type MyType, myFunction } from "bun";

const myInterface: MyInterface = {};
const myType: MyType = "cool";
myFunction();
```

2. Using the global `Bun` object:

```typescript
const myInterface: Bun.MyInterface = {};
const myType: Bun.MyType = "cool";
Bun.myFunction();
```

Consuming them inside the ambient declarations is also easy:

```ts
// These are equivalent
type A = import("bun").MyType;
type A = Bun.MyType;
```

## File Structure

Types are organized across multiple `.d.ts` files in the `packages/bun-types` directory:

- `index.d.ts` - The main entry point that references all other type files
- `bun.d.ts` - Core Bun APIs and types
- `globals.d.ts` - Global type declarations
- `test.d.ts` - Testing-related types
- `sqlite.d.ts` - SQLite-related types
- `ts7.1/` - Declarations that need TypeScript 7.1 syntax, such as `declare module "*" with { type: "text" }`. Older compilers reject that syntax even with `skipLibCheck`, so `typesVersions` in `package.json` sends TypeScript 7.1 and newer to `ts7.1/index.d.ts`, which references `../index.d.ts` plus the extra files. Every other version keeps loading `index.d.ts`. Prettier and the repository's own `tsconfig.json` skip this folder for the same reason.
- ...etc. You can make more files

Note: The order of references in `index.d.ts` is important - `bun.ns.d.ts` must be referenced last to ensure the `Bun` global gets defined properly.

### Best Practices

1. **Type Safety**
   - Please use strict types instead of `any` where possible
   - Leverage TypeScript's type system features (generics, unions, etc.)
   - Document complex types with JSDoc comments

2. **Compatibility**
   - Use `Bun.__internal.UseLibDomIfAvailable<LibDomName extends string, OurType>` for types that might conflict with lib.dom.d.ts (see [`./fetch.d.ts`](./fetch.d.ts) for a real example)
   - `@types/node` often expects variables to always be defined (this was the biggest cause of most of the conflicts in the past!), so we use the `UseLibDomIfAvailable` type to make sure we don't overwrite `lib.dom.d.ts` but still provide Bun types while simultaneously declaring the variable exists (for Node to work) in the cases that we can.

3. **Documentation**
   - Add JSDoc comments for public APIs
   - Include examples in documentation when helpful
   - Document default values and important behaviors

### Internal Types

For internal types that shouldn't be exposed to users, use the `__internal` namespace:

```typescript
declare module "bun" {
  namespace __internal {
    interface MyInternalType {
      // ...
    }
  }
}
```

The internal namespace is mostly used for declaring things that shouldn't be globally accessible on the `bun` namespace, but are still used in public apis. You can see a pretty good example of that in the [`./fetch.d.ts`](./fetch.d.ts) file.

## Testing Types

We test our type definitions using a special test file at `fixture/index.ts`. This file contains TypeScript code that exercises our type definitions, but is never actually executed - it's only used to verify that the types work correctly.

The test file is type-checked in two different environments:

1. With `lib.dom.d.ts` included - This simulates usage in a browser environment where DOM types are available
2. Without `lib.dom.d.ts` - This simulates usage in a server-like environment without DOM types

Your type definitions must work properly in both environments. This ensures that Bun's types are compatible regardless of whether DOM types are present or not.

For example, if you're adding types for a new API, you should just add code to `fixture/index.ts` that uses your new API. Doesn't need to work at runtime (e.g. you can fake api keys for example), it's just checking that the types are correct.

## Declarations that lib.dom also has

A project can load `lib.dom.d.ts` together with bun-types. The React templates of `bun init` write `"lib": ["ESNext", "DOM"]`. TypeScript then merges each global that both declare. bun-types is loaded after the lib files, so a call tries a signature that bun-types declares before the signature of lib.dom.

So a declaration of bun-types for a global of lib.dom must add nothing when lib.dom is loaded. This is how to gate one:

- An interface gets its members from a base that is `{}` when lib.dom is loaded.

  ```typescript
  declare module "bun" {
    namespace __internal {
      interface BunEvent {
        // the members
      }
      type LibEmptyOrBunEvent = LibDomIsLoaded extends true ? {} : BunEvent;
    }
  }

  interface Event extends Bun.__internal.LibEmptyOrBunEvent {}
  ```

- A `var` is typed with `Bun.__internal.UseLibDomIfAvailable<"Name", TypeWithoutLibDom>`.

A member that only Bun has does not go behind the gate, because a project that loads lib.dom then does not get it. Put it in a base that is always on, as `BunHeadersOverride` in [`./fetch.d.ts`](./fetch.d.ts) does for `Headers.toJSON()`.

The case "checks with lib.dom.d.ts" of `test/integration/bun-types/bun-types.test.ts` finds every declaration of bun-types that is not gated. It also finds every gated member, and every static of a gated `var`, that lib.dom does not have. It compares the result with the list `expectedLibOverlapWithLibDom` in that file, and it fails when the two differ. The comment on `libOverlap` in that file says how to read an entry. The list also has the members that bun-types adds to the interfaces of lib.es, such as `ArrayBuffer` and `Error`.

When the test fails for a declaration that you added, gate the declaration. Add an entry to the list only when the declaration cannot be gated, for example a function overload or a member that only Bun has. Put it in the section whose reason holds for it. When the new entry says `only without the lib`, move the member to a base that is always on. The check compares names, not signatures.

The list says which declarations land on a lib symbol, not what they say. A changed signature of a member that is already listed is a diff in the inventory.

## The type inventory

`test/integration/bun-types/inventory/<preset>.txt` lists every symbol that has a declaration in bun-types, with the shape the TypeScript checker resolves it to: the globals, the exports of the modules bun-types declares (`bun`, `bun:test`, `*.html`), and the exports it adds to node modules and namespaces (`node:tls`, `NodeJS`). The members of a listed symbol are printed in full, wherever they come from. Interface merging with `lib.dom.d.ts` and `@types/node`, `UseLibDomIfAvailable`, and every other conditional alias are resolved, so a file shows what a user sees, not what the `.d.ts` source says.

There is one file per preset:

- `esnext`, `esnext-dom`, `es2022`, `es2022-dom`, and `no-lib` are `types: ["bun"]` with that `lib`.
- `test-globals` and `vitest-globals` are the entry points that `index.d.ts` does not load. A project loads them with `/// <reference types="bun-types/test-globals" />` or `/// <reference types="bun-types/vitest-globals" />`. Each file lists only what the entry point adds.
- `ts7.1/` is not covered.

A file has one section per module (`# module "bun:test"`), then `# globals`. The section says what an entry is: an entry under `# module "vitest"` is an export of `"vitest"`, and an entry under `# globals` is a global. The last section lists the declarations that the listed types name and that nothing exports, such as an interface that a module keeps to itself.

How to read a line:

- `name(a: A): B` is a method, with one line per overload. `name: (a: A) => B` is a property with a function type. TypeScript compares the parameters of a method bivariantly, so a change from one form to the other is a type change.
- Overloads are in the order in which a call tries them. The first line that accepts the arguments is the one a user gets. When an interface merges with `lib.dom.d.ts`, the signatures of the later declaration come first, and bun-types is loaded after the lib files. So in `esnext-dom` a signature that bun-types declares inline wins over the one of lib.dom.
- `[?]`, `[readonly]`, `[static]`, `[private]`, `[protected]` and `[abstract]` after a name are its modifiers. The presets set `exactOptionalPropertyTypes`, so `x [?]: T` is `x?: T` and `x [?]: T | undefined` is `x?: T | undefined`.
- `x [set: U]: T` is an accessor that returns `T` and accepts `U`.
- `<const T>`, `<in T>` and `<out T>` are the modifiers of a type parameter.
- `const x`, `let x` and `var x` are the declaration as written. Only a global `var` is also a property of `globalThis`.
- `class X extends Y` names the base class. The list of `X` includes the members that it inherits from `Y`.
- Inside a type, `Bun.X` is an export of the module `"bun"` and `import("bun:test").X` is an export of another module. A name with no prefix is a global, or one of the declarations in the last section.
- `a -> Bun.b` means that `a` is another name for `Bun.b`, which has its own entry.
- `a [type only] -> b` is `export type { b as a }` of a class, an enum or a namespace. `a` names the type and not the value.
- `type X = unknown [written: A extends B ? C : D]` is a conditional type that TypeScript has already resolved for the preset. The text in brackets is the source. A change to the branch that no preset takes shows there.
- `...` stands for the type literal that the line is part of (`vi.useFakeTimers(): ...`).
- The members of a union are in alphabetical order, not in source order. The exception is the text of a mapped type, an indexed access type, or a conditional type with `infer`. TypeScript prints that text, and a union inside it is in the order of TypeScript, which can change when a declaration moves.

`test/integration/bun-types/inventory.test.ts` fails when the files no longer match the package. After a change to `packages/bun-types`, regenerate them and commit the result:

```sh
bun packages/bun-types/scripts/inventory.ts
```

Read the diff before you commit it. A line that disappears from a preset, or a member whose type changed, can break the users on that preset. Check each one. A return type that changes is a change for every caller. A parameter that accepts more is safe only when no overload comes after it: a wider overload takes the calls that a later overload got before. A change that only moves a declaration produces no diff when it stays in its file. A move to another file changes the file name in parentheses after the symbol, and nothing else.

## Questions

Feel free to open an issue or speak to any of the more TypeScript-focused team members if you need help authoring types or fixing type tests.
