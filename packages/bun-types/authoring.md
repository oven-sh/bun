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

## Questions

Feel free to open an issue or speak to any of the more TypeScript-focused team members if you need help authoring types or fixing type tests.
