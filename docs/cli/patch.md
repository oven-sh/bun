If you need to modify the contents of a package, call `bun patch <pkg>` with the package's name (and optionally a version),
for example:

```bash
$ bun patch react
```

This will copy the package to a temporary directory, where you can make changes to the package's contents.

Once you're done making changes, run `bun patch-commit <temp-directory_path>` to have Bun install the patched package.
