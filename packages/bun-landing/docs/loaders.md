## Loaders

A loader determines how to map imports &amp; file extensions to transforms and output.

Currently, bun implements the following loaders:

| Input | Loader                        | Output |
| ----- | ----------------------------- | ------ |
| .js   | JSX + JavaScript              | .js    |
| .jsx  | JSX + JavaScript              | .js    |
| .ts   | TypeScript + JavaScript       | .js    |
| .tsx  | TypeScript + JSX + JavaScript | .js    |
| .mjs  | JavaScript                    | .js    |
| .cjs  | JavaScript                    | .js    |
| .mts  | TypeScript                    | .js    |
| .cts  | TypeScript                    | .js    |
| .toml | TOML                          | .js    |
| .css  | CSS                           | .css   |
| .env  | Env                           | N/A    |
| .\*   | file                          | string |

Everything else is treated as `file`. `file` replaces the import with a URL (or a path).

You can configure which loaders map to which extensions by passing `--loaders` to `bun`. For example:

```sh
bun --loader=.js:js
```

This will disable JSX transforms for `.js` files.
