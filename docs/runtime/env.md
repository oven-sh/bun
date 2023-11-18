Bun reads your `.env` files automatically and provides idiomatic ways to read and write your environment variables programmatically. Plus, some aspects of Bun's runtime behavior can be configured with Bun-specific environment variables.

## Setting environment variables

Bun reads the following files automatically (listed in order of increasing precedence).

- `.env`
- `.env.production`, `.env.development`, `.env.test` (depending on value of `NODE_ENV`)
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

### Quotation marks

Bun supports double quotes, single quotes, and

### Expansion

Environment variables are automatically _expanded_. This means you can reference previously-defined variables in your environment variables.

```txt#.env
FOO=world
BAR=hello$FOO
```

```ts
process.env.BAR; // => "helloworld"
```

This is useful for constructing connection strings or other compound values.

```txt#.env
DB_USER=postgres
DB_PASSWORD=secret
DB_HOST=localhost
DB_PORT=5432
DB_URL=postgres://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME
```

This can be disabled by escaping the `$` with a backslash.

```txt#.env
FOO=world
BAR=hello\$FOO
```

```ts
process.env.BAR; // => "hello$FOO"
```

### `dotenv`

Generally speaking, you won't need `dotenv` or `dotenv-expand` anymore, because Bun reads `.env` files automatically.

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

## TypeScript

In TypeScript, all properties of `process.env` are typed as `string | undefined`.

```ts
Bun.env.whatever;
// string | undefined
```

To get autocompletion and tell TypeScript to treat a variable as a non-optional string, we'll use [interface merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html#merging-interfaces).

```ts
declare module "bun" {
  interface Env {
    AWESOME: string;
  }
}
```

Add this line to any file in your project. It will globally add the `AWESOME` property to `process.env` and `Bun.env`.

```ts
process.env.AWESOME; // => string
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

---

- `DO_NOT_TRACK`
- If `DO_NOT_TRACK=1`, then analytics are [disabled](https://do-not-track.dev/). Bun records bundle timings (so we can answer with data, "is Bun getting faster?") and feature usage (e.g., "are people actually using macros?"). The request body size is about 60 bytes, so it's not a lot of data. Equivalent of `telemetry=false` in bunfig.

{% /table %}
