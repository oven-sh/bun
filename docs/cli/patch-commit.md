An alias for `bun patch --commit` to maintain compatibility with pnpm.

To get started with patch, first prepare the package for patching with [`bun patch <pkg>`](https://bun.sh/docs/install/patch).

### `--patches-dir`

By default, `bun patch-commit` will use the `patches` directory in the temporary directory.

You can specify a different directory with the `--patches-dir` flag.

{% bunCLIUsage command="patch-commit" /%}
