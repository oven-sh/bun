To update all dependencies to the latest version:

```sh
$ bun update
```

To update a specific dependency to the latest version:

```sh
$ bun update [package]
```

## `--latest`

By default, `bun update` will update to the latest version of a dependency that satisfies the version range specified in your `package.json`.

To update to the latest version, regardless of if it's compatible with the current version range, use the `--latest` flag:

```sh
$ bun update --latest
```

For example, with the following `package.json`:

```json
{
  "dependencies": {
    "react": "^17.0.2"
  }
}
```

- `bun update` would update to a version that matches `17.x`.
- `bun update --latest` would update to a version that matches `18.x` or later.

{% bunCLIUsage command="update" /%}