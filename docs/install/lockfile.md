Running `bun install` will create a binary lockfile called `bun.lockb`.

#### Why is it binary?

In a word: Performance. Bun’s lockfile saves & loads incredibly quickly, and saves a lot more data than what is typically inside lockfiles.

#### How do I inspect it?

Run `bun install -y` to generate a Yarn-compatible `yarn.lock` (v1) that can be inspected more easily.

#### Platform-specific dependencies?

Bun stores normalized `cpu` and `os` values from npm in the lockfile, along with the resolved packages. It skips downloading, extracting, and installing packages disabled for the current target at runtime. This means the lockfile won’t change between platforms/architectures even if the packages ultimately installed do change.

#### What does the lockfile store?

Packages, metadata for those packages, the hoisted install order, dependencies for each package, what packages those dependencies resolved to, an integrity hash (if available), what each package was resolved to, and which version (or equivalent).

#### Why is it fast?

It uses linear arrays for all data. [Packages](https://github.com/oven-sh/bun/blob/be03fc273a487ac402f19ad897778d74b6d72963/src/install/install.zig#L1825) are referenced by an auto-incrementing integer ID or a hash of the package name. Strings longer than 8 characters are de-duplicated. Prior to saving on disk, the lockfile is garbage-collected & made deterministic by walking the package tree and cloning the packages in dependency order.

#### Can I opt out?

To install without creating a lockfile:

```bash
$ bun install --no-save
```

To install a Yarn lockfile _in addition_ to `bun.lockb`.

{% codetabs %}

```bash#CLI flag
$ bun install --yarn
```

```toml#bunfig.toml
[install.lockfile]
# whether to save a non-Bun lockfile alongside bun.lockb
# only "yarn" is supported
print = "yarn"
```

{% /codetabs %}

{% details summary="Configuring lockfile" %}

```toml
[install.lockfile]

# path to read bun.lockb from
path = "bun.lockb"

# path to save bun.lockb to
savePath = "bun.lockb"

# whether to save the lockfile to disk
save = true

# whether to save a non-Bun lockfile alongside bun.lockb
# only "yarn" is supported
print = "yarn"
```

{% /details %}
