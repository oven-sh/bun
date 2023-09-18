Bun reads your `.env` files automatically and provides idiomatic ways to read and write your environment variables programmatically. Plus, some aspects of Bun's runtime behavior can be configured with Bun-specific environment variables.

## Setting environment variables

Bun reads the following files automatically (listed in order of increasing precedence).

- `.env`
- `.env.production` or `.env.development` (depending on value of `NODE_ENV`)
- `.env.local`

```txt#.env
FOO=hello
BAR=world
```

Variables can also be set via the command line.

```sh
$ FOO=helloworld bun run dev
```

Or programmatically by assigning a property to `process.env`.

```ts
process.env.FOO = "hello";
```

### `dotenv`

Generally speaking, you won't need `dotenv` anymore, because Bun reads `.env` files automatically.

## Reading environment variables

The current environment variables can be accessed via `process.env`.

```ts
process.env.API_TOKEN; // => "secret"
```

Bun also exposes these variables via `Bun.env`, which is a simple alias of `process.env`.

```ts
Bun.env.API_TOKEN; // => "secret"
```

To print all currently-set environment variables to the command line, run `bun run env`. This is useful for debugging.

```sh
$ bun run env
BAZ=stuff
FOOBAR=aaaaaa
<lots more lines>
```

## Configuring Bun

These environment variables are read by Bun and configure aspects of its behavior.

{% table %}

- Name
- Description

---

- `TMPDIR`
- Bun occasionally requires a directory to store intermediate assets during bundling or other operations. If unset, defaults to the platform-specific temporary directory: `/tmp` on Linux, `/private/tmp` on macOS.

---

- `NO_COLOR`
- If `NO_COLOR=1`, then ANSI color output is [disabled](https://no-color.org/).

---

- `FORCE_COLOR`
- If `FORCE_COLOR=1`, then ANSI color output is force enabled, even if `NO_COLOR` is set.
