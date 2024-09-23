---
name: Get the current Bun version
---

Get the current version of Bun in a semver format.

```ts#index.ts
Bun.version; // => "0.6.15"
```

---

Get the exact `git` commit of [`oven-sh/bun`](https://github.com/oven-sh/bun) that was compiled to produce this Bun binary.

```ts#index.ts
Bun.revision; // => "49231b2cb9aa48497ab966fc0bb6b742dacc4994"
```

---

See [Docs > API > Utils](https://bun.sh/docs/api/utils) for more useful utilities.
