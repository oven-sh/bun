An alias for `bun patch --commit` to maintain compatibility with pnpm.

You must prepare the package for patching with [`bun patch <pkg>`](/docs/cli/patch) first.

### `--patches-dir`

By default, `bun patch-commit` will use the `patches` directory in the temporary directory.

You can specify a different directory with the `--patches-dir` flag.
