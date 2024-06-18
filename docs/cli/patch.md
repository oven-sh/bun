Bun lets you easily make quick fixes to packages and have those changes work consistently across multiple installs and machines, without having to go through the work of forking and publishing a new version of the package.

To get started, use `bun patch <pkg>` to prepare it for patching:

```bash
# you can supply the package name
$ bun patch react

# ...and a precise version in case multiple versions are installed
$ bun patch react@17.0.2

# or the path to the package
$ bun patch node_modules/react
```

The output of this command will give you the path to the package in `node_modules/` where you can make your changes to the package.

This allows you to test your changes before committing them.

{% callout %}
**Note** — Don't forget to call `bun patch <pkg>`! This ensures the package folder in `node_modules/` contains a fresh copy of the package with no symlinks/hardlinks to Bun's cache.

If you forget to do this, you might end up editing the package globally in the cache!
{% /callout %}

Once you're happy with your changes, run `bun patch --commit <path or pkg>`.

Bun will generate a patch file in `patches/`, update your `package.json` and lockfile, and Bun will start using the patched package:

```bash
# you can supply the path to the patched package
$ bun patch --commit node_modules/react

# ... or the package name and optionally the version
$ bun patch --commit react@17.0.2

# choose the directory to store the patch files
$ bun patch --commit react --patches-dir=mypatches

# `patch-commit` is available for compatibility with pnpm
$ bun patch-commit react
```
