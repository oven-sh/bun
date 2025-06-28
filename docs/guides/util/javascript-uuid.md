---
name: Generate a UUID
---

Use `crypto.randomUUID()` to generate a UUID v4. This API works in Bun, Node.js, and browsers. It requires no dependencies.

```ts
crypto.randomUUID();
// => "123e4567-e89b-12d3-a456-426614174000"
```

---

In Bun, you can also use `Bun.randomUUIDv7()` to generate a [UUID v7](https://www.ietf.org/archive/id/draft-peabody-dispatch-new-uuid-format-01.html).

```ts
Bun.randomUUIDv7();
// => "0196a000-bb12-7000-905e-8039f5d5b206"
```

---

See [Docs > API > Utils](https://bun.sh/docs/api/utils) for more useful utilities.
