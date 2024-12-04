---
name: Set environment variables
---

The current environment variables can be accessed via `process.env` or `Bun.env`.

```ts
Bun.env.API_TOKEN; // => "secret"
process.env.API_TOKEN; // => "secret"
```

---

Set these variables in a `.env` file.

Bun reads the following files automatically (listed in order of increasing precedence).

- `.env`
- `.env.production`, `.env.development`, `.env.test` (depending on value of `NODE_ENV`)
- `.env.local`

```txt#.env
FOO=hello
BAR=world
```

---

Variables can also be set via the command line.

```sh
$ FOO=helloworld bun run dev
```

---

See [Docs > Runtime > Environment variables](https://bun.sh/docs/runtime/env) for more information on using environment variables with Bun.
