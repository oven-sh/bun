Use `bun outdated` to display a table of outdated dependencies with their latest versions:

```sh
$ bun outdated

|--------------------------------------------------------------------|
| Packages                               | Current | Update | Latest |
|----------------------------------------|---------|--------|--------|
| @types/bun (dev)                       | 1.1.6   | 1.1.7  | 1.1.7  |
|----------------------------------------|---------|--------|--------|
| @types/react (dev)                     | 18.3.3  | 18.3.4 | 18.3.4 |
|----------------------------------------|---------|--------|--------|
| @typescript-eslint/eslint-plugin (dev) | 7.16.1  | 7.18.0 | 8.2.0  |
|----------------------------------------|---------|--------|--------|
| @typescript-eslint/parser (dev)        | 7.16.1  | 7.18.0 | 8.2.0  |
|----------------------------------------|---------|--------|--------|
| esbuild (dev)                          | 0.21.5  | 0.21.5 | 0.23.1 |
|----------------------------------------|---------|--------|--------|
| eslint (dev)                           | 9.7.0   | 9.9.1  | 9.9.1  |
|----------------------------------------|---------|--------|--------|
| typescript (dev)                       | 5.5.3   | 5.5.4  | 5.5.4  |
|--------------------------------------------------------------------|
```

The `Update` column shows the version that would be installed if you ran `bun update [package]`. This version is the latest version that satisfies the version range specified in your `package.json`.

The `Latest` column shows the latest version available from the registry. `bun update --latest [package]` will update to this version.
