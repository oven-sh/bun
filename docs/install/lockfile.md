Running `bun install` will create a binary lockfile called `bun.lockb`.

#### Why is it binary?

In a word: Performance. Bun’s lockfile saves & loads incredibly quickly, and saves a lot more data than what is typically inside lockfiles.

#### How do I inspect Bun's lockfile?

Run `bun install -y` to generate a Yarn-compatible `yarn.lock` (v1) that can be inspected more easily.

#### How do I `git diff` Bun's lockfile?

Add the following to your local or global `.gitattributes` file:

```
*.lockb binary diff=lockb
```

Then add the following to your local git config with:

```sh
$ git config diff.lockb.textconv bun
$ git config diff.lockb.binary true
```

Or to your global git config (system-wide) with the `--global` option:

```sh
$ git config --global diff.lockb.textconv bun
$ git config --global diff.lockb.binary true
```

**Why this works:**

- `textconv` tells git to run `bun` on the file before diffing
- `binary` tells git to treat the file as binary (so it doesn't try to diff it line-by-line)

Running `bun` on a lockfile will print a human-readable diff. So we just need to tell `git` to run `bun` on the lockfile before diffing it.

#### Platform-specific dependencies?

Bun stores normalized `cpu` and `os` values from npm in the lockfile, along with the resolved packages. It skips downloading, extracting, and installing packages disabled for the current target at runtime. This means the lockfile won’t change between platforms/architectures even if the packages ultimately installed do change.

#### What does Bun's lockfile store?

Packages, metadata for those packages, the hoisted install order, dependencies for each package, what packages those dependencies resolved to, an integrity hash (if available), what each package was resolved to, and which version (or equivalent).

#### Why is Bun's lockfile fast?

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

### Text-based lockfile

Bun v1.1.39 introduced `bun.lock`, a JSONC formatted lockfile. `bun.lock` is human-readable and git-diffable without configuration, at [no cost to performance](https://bun.sh/blog/bun-lock-text-lockfile#cached-bun-install-gets-30-faster).

To generate the lockfile, use `--save-text-lockfile` with `bun install`. You can do this for new projects and existing projects already using `bun.lockb` (resolutions will be preserved).

```bash
$ bun install --save-text-lockfile
$ head -n3 bun.lock
{
  "lockfileVersion": 0,
  "workspaces": {
```

Once `bun.lock` is generated, Bun will use it for all subsequent installs and updates through commands that read and modify the lockfile. If both lockfiles exist, `bun.lock` will be choosen over `bun.lockb`.

Bun v1.2.0 will switch the default lockfile format to `bun.lock`.

{% /codetabs %}

{% details summary="Configuring lockfile" %}

```toml
[install.lockfile]

# whether to save the lockfile to disk
save = true

# whether to save a non-Bun lockfile alongside bun.lockb
# only "yarn" is supported
print = "yarn"
```

{% /details %}
