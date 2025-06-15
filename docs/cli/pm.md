The `bun pm` command group provides a set of utilities for working with Bun's package manager.

## pack

To create a tarball of the current workspace:

```bash
$ bun pm pack
```

Options for the `pack` command:

- `--dry-run`: Perform all tasks except writing the tarball to disk.
- `--destination`: Specify the directory where the tarball will be saved.
- `--filename`: Specify an exact file name for the tarball to be saved at.
- `--ignore-scripts`: Skip running pre/postpack and prepare scripts.
- `--gzip-level`: Set a custom compression level for gzip, ranging from 0 to 9 (default is 9).

> Note `--filename` and `--destination` cannot be used at the same time

## bin

To print the path to the `bin` directory for the local project:

```bash
$ bun pm bin
/path/to/current/project/node_modules/.bin
```

To print the path to the global `bin` directory:

```bash
$ bun pm bin -g
<$HOME>/.bun/bin
```

## List packages

List installed packages in the current project and their dependencies.

```bash
$ bun list
```

This is the primary way to list packages. You can also use the alias:

```bash
$ bun pm ls
```

By default, this command only lists top-level dependencies. To list the entire dependency tree:

```bash
$ bun list --all
```

Alternative:

```bash
$ bun pm ls --all
```

## whoami

Print your npm username. Requires you to be logged in (`bunx npm login`) with credentials in either `bunfig.toml` or `.npmrc`:

```bash
$ bun pm whoami
```

## hash

To generate and print the hash of the current lockfile:

```bash
$ bun pm hash
```

To print the string used to hash the lockfile:

```bash
$ bun pm hash-string
```

To print the hash stored in the current lockfile:

```bash
$ bun pm hash-print
```

## cache

To print the path to Bun's global module cache:

```bash
$ bun pm cache
```

To clear Bun's global module cache:

```bash
$ bun pm cache rm
```

## migrate

To migrate another package manager's lockfile without installing anything:

```bash
$ bun pm migrate
```

## untrusted

To print current untrusted dependencies with scripts:

```bash
$ bun pm untrusted

./node_modules/@biomejs/biome @1.8.3
 » [postinstall]: node scripts/postinstall.js

These dependencies had their lifecycle scripts blocked during install.
```

## trust

To run scripts for untrusted dependencies and add to `trustedDependencies`:

```bash
$ bun pm trust <names>
```

Options for the `trust` command:

- `--all`: Trust all untrusted dependencies.

## default-trusted

To print the default trusted dependencies list:

```bash
$ bun pm default-trusted
```

see the current list on GitHub [here](https://github.com/oven-sh/bun/blob/main/src/install/default-trusted-dependencies.txt)
