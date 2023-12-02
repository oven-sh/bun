---
name: Detect when code is executed with Bun
---

The recommended way to conditionally detect when code is being executed with `bun` is to check for the existence of the `Bun` global.

This is similar to how you'd check for the existence of the `window` variable to detect when code is being executed in a browser.

```ts
if (typeof Bun !== "undefined") {
  // this code will only run when the file is run with Bun
}
```

---

In TypeScript environments, the previous approach will result in a type error unless `bun-types` is globally installed. To avoid this, you can check `process.versions` instead.

```ts
if (process.versions.bun) {
  // this code will only run when the file is run with Bun
}
```
