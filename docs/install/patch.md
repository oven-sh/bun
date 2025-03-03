`bun patch` lets you persistently patch node_modules in a maintainable, git-friendly way.

Sometimes, you need to make a small change to a package in `node_modules/` to fix a bug or add a feature. `bun patch` makes it easy to do this without vendoring the entire package and reuse the patch across multiple installs, multiple projects, and multiple machines.

Features:

- Generates `.patch` files applied to dependencies in `node_modules` on install
- `.patch` files can be committed to your repository, reused across multiple installs, projects, and machines
- `"patchedDependencies"` in `package.json` keeps track of patched packages
- `bun patch` lets you patch packages in `node_modules/` while preserving the integrity of Bun's [Global Cache](https://bun.sh/docs/install/cache)
- Test your changes locally before committing them with `bun patch --commit <pkg>`
- To preserve disk space and keep `bun install` fast, patched packages are committed to the Global Cache and shared across projects where possible

#### Step 1. Prepare the package for patching

To get started, use `bun patch <pkg>` to prepare the package for patching:

```bash
# you can supply the package name
$ bun patch react

# ...and a precise version in case multiple versions are installed
$ bun patch react@17.0.2

# or the path to the package
$ bun patch node_modules/react
```

{% callout %}
**Note** — Don't forget to call `bun patch <pkg>`! This ensures the package folder in `node_modules/` contains a fresh copy of the package with no symlinks/hardlinks to Bun's cache.

If you forget to do this, you might end up editing the package globally in the cache!
{% /callout %}

#### Step 2. Test your changes locally

`bun patch <pkg>` makes it safe to edit the `<pkg>` in `node_modules/` directly, while preserving the integrity of Bun's [Global Cache](https://bun.sh/docs/install/cache). This works by re-creating an unlinked clone of the package in `node_modules/` and diffing it against the original package in the Global Cache.

#### Step 3. Commit your changes

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

{% bunCLIUsage command="patch" /%}