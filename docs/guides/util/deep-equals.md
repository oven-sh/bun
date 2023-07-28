---
name: Check if two objects are deeply equal
---

Check if two objects are deeply equal. This is used internally by `expect().toEqual()` in Bun's [test runner](/docs/test/writing).

```ts#index.ts
const a = { a: 1, b: 2, c: { d: 3 } };
const b = { a: 1, b: 2, c: { d: 3 } };

Bun.deepEquals(a, b); // true
```

---

Pass `true` as a third argument to enable strict mode. This is used internally by `expect().toStrictEqual()` in Bun's [test runner](/docs/test/writing).

The following examples would return `true` in non-strict mode but `false` in strict mode.

```ts
// undefined values
Bun.deepEquals({}, { a: undefined }, true); // false

// undefined in arrays
Bun.deepEquals(["asdf"], ["asdf", undefined], true); // false

// sparse arrays
Bun.deepEquals([, 1], [undefined, 1], true); // false

// object literals vs instances w/ same properties
class Foo {
  a = 1;
}
Bun.deepEquals(new Foo(), { a: 1 }, true); // false
```

---

See [Docs > API > Utils](/docs/api/utils) for more useful utilities.
