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

## ls

To print a list of installed dependencies in the current project and their resolved versions, excluding their dependencies.

```bash
$ bun pm ls
/path/to/project node_modules (135)
├── eslint@8.38.0
├── react@18.2.0
├── react-dom@18.2.0
├── typescript@5.0.4
└── zod@3.21.4
```

To print all installed dependencies, including nth-order dependencies.

```bash
$ bun pm ls --all
/path/to/project node_modules (135)
├── @eslint-community/eslint-utils@4.4.0
├── @eslint-community/regexpp@4.5.0
├── @eslint/eslintrc@2.0.2
├── @eslint/js@8.38.0
├── @nodelib/fs.scandir@2.1.5
├── @nodelib/fs.stat@2.0.5
├── @nodelib/fs.walk@1.2.8
├── acorn@8.8.2
├── acorn-jsx@5.3.2
├── ajv@6.12.6
├── ansi-regex@5.0.1
├── ...
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

## version

To display current package version and help:

```bash
$ bun pm version
bun pm version v$BUN_LATEST_VERSION (ca7428e9)
Current package version: v1.0.0

Increment:
  patch      1.0.0 → 1.0.1
  minor      1.0.0 → 1.1.0
  major      1.0.0 → 2.0.0
  prerelease 1.0.0 → 1.0.1-0
  prepatch   1.0.0 → 1.0.1-0
  preminor   1.0.0 → 1.1.0-0
  premajor   1.0.0 → 2.0.0-0
  from-git   Use version from latest git tag
  1.2.3      Set specific version

Options:
  --no-git-tag-version Skip git operations
  --allow-same-version Prevents throwing error if version is the same
  --message=<val>, -m  Custom commit message, use %s for version substitution
  --preid=<val>        Prerelease identifier (i.e beta → 1.0.1-beta.0)
  --force, -f          Bypass dirty git history check

Examples:
  $ bun pm version patch
  $ bun pm version 1.2.3 --no-git-tag-version
  $ bun pm version prerelease --preid beta --message "Release beta: %s"
```

To bump the version in `package.json`:

```bash
$ bun pm version patch
v1.0.1
```

Supports `patch`, `minor`, `major`, `premajor`, `preminor`, `prepatch`, `prerelease`, `from-git`, or specific versions like `1.2.3`. By default creates git commit and tag unless `--no-git-tag-version` was used to skip.
