Running `bun install` will create a lockfile called `bun.lock`.

#### Should it be committed to git?

Yes

#### Generate a lockfile without installing?

To generate a lockfile without installing to `node_modules` you can use the `--lockfile-only` flag. The lockfile will always be saved to disk, even if it is up-to-date with the `package.json`(s) for your project.

```bash
$ bun install --lockfile-only
```

{% callout %}
**Note** - using `--lockfile-only` will still populate the global install cache with registry metadata and git/tarball dependencies.
{% /callout %}

#### Can I opt out?

To install without creating a lockfile:

```bash
$ bun install --no-save
```

To install a Yarn lockfile _in addition_ to `bun.lock`.

{% codetabs %}

```bash#CLI flag
$ bun install --yarn
```

```toml#bunfig.toml
[install.lockfile]
# whether to save a non-Bun lockfile alongside bun.lock
# only "yarn" is supported
print = "yarn"
```

{% /codetabs %}

#### Text-based lockfile

Bun v1.2 changed the default lockfile format to the text-based `bun.lock`. Existing binary `bun.lockb` lockfiles can be migrated to the new format by running `bun install --save-text-lockfile --frozen-lockfile --lockfile-only` and deleting `bun.lockb`.

More information about the new lockfile format can be found on [our blogpost](https://bun.sh/blog/bun-lock-text-lockfile).
