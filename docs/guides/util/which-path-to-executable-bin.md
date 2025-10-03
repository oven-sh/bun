---
name: Get the path to an executable bin file
---

`Bun.which` is a utility function to find the absolute path of an executable file. It is similar to the `which` command in Unix-like systems.

```ts#foo.ts
Bun.which("sh"); // => "/bin/sh"
Bun.which("notfound"); // => null
Bun.which("bun"); // => "/home/user/.bun/bin/bun"
```

---

See [Docs > API > Utils](https://bun.com/docs/api/utils#bun-which) for complete documentation.
