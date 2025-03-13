# Authoring @types/bun

### Module Declaration

The `Bun` global variable and the `'bun'` module are now declared in one place. It supports declaring types/interfaces and also runtime values.

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

The above can now be used like this

```ts
import { type MyInterface, type MyType, myFunction } from "bun";
const myInterface: MyInterface = {};
const myType: MyType = "cool";
myFunction();
// OR
const myInterface: Bun.MyInterface = {};
const myType: Bun.MyType = "cool";
Bun.myFunction();
```

### File structure

Types are organized across multiple `.d.ts` files in the `packages/bun-types` directory:

- `bun.d.ts` - Core Bun APIs and types
- `globals.d.ts` - Global type declarations
- `test.d.ts` - Testing-related types
- `sqlite.d.ts` - SQLite-related types
- etc.

All these files are referenced in `index.d.ts` using `/// <reference path="./file.d.ts" />`.

Make sure to leave the `bun.ns.d.ts` reference last.

### Best Practices

1. **Type Safety**

   - Please use strict types instead of `any` where possible
   - Leverage TypeScript's type system features (generics, unions, etc.)
   - Document complex types with JSDoc comments

2. **Compatibility**

   - Use `Bun.__internal.UseLibDomIfAvailable` for types that might conflict with lib.dom.d.ts
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

There is a `fixture/index.ts` file which doesn't actually ever get ran, but does get type-checked in two environments - with lib.dom.d.ts, and without.

Your types should pass in both environments!

## Questions

Feel free to open an issue or speak to any of the more TypeScript-focused team members if you need help authoring types or fixing type tests.
