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

{% codetabs %}

```sh#Linux/macOS
$ FOO=helloworld bun run dev
```

```sh#Windows
# Using CMD
$ set FOO=helloworld && bun run dev

# Using PowerShell
$ $env:FOO="helloworld"; bun run dev
```

## {% /codetabs %}

See [Docs > Runtime > Environment variables](https://bun.sh/docs/runtime/env) for more information on using environment variables with Bun.
