---
name: Read environment variables
---

The current environment variables can be accessed via `process.env`.

```ts
process.env.API_TOKEN; // => "secret"
```

---

Bun also exposes these variables via `Bun.env`, which is a simple alias of `process.env`.

```ts
Bun.env.API_TOKEN; // => "secret"
```

---

To print all currently-set environment variables to the command line, run `bun --print process.env`. This is useful for debugging.

```sh
$ bun --print process.env
BAZ=stuff
FOOBAR=aaaaaa
<lots more lines>
```

---

See [Docs > Runtime > Environment variables](https://bun.sh/docs/runtime/env) for more information on using environment variables with Bun.
