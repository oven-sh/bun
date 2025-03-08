The `--filter` (or `-F`) flag is used for selecting packages by pattern in a monorepo. Patterns can be used to match package names or package paths, with full glob syntax support.

Currently `--filter` is supported by `bun install` and `bun outdated`, and can also be used to run scripts for multiple packages at once.

## Matching

### Package Name `--filter <pattern>`

Name patterns select packages based on the package name, as specified in `package.json`. For example, if you have packages `pkg-a`, `pkg-b` and `other`, you can match all packages with `*`, only `pkg-a` and `pkg-b` with `pkg*`, and a specific package by providing the full name of the package.

### Package Path `--filter ./<glob>`

Path patterns are specified by starting the pattern with `./`, and will select all packages in directories that match the pattern. For example, to match all packages in subdirectories of `packages`, you can use `--filter './packages/**'`. To match a package located in `packages/foo`, use `--filter ./packages/foo`.

## `bun install` and `bun outdated`

Both `bun install` and `bun outdated` support the `--filter` flag.

`bun install` by default will install dependencies for all packages in the monorepo. To install dependencies for specific packages, use `--filter`.

Given a monorepo with workspaces `pkg-a`, `pkg-b`, and `pkg-c` under `./packages`:

```bash
# Install dependencies for all workspaces except `pkg-c`
$ bun install --filter '!pkg-c'

# Install dependencies for packages in `./packages` (`pkg-a`, `pkg-b`, `pkg-c`)
$ bun install --filter './packages/*'

# Save as above, but exclude the root package.json
$ bun install --filter --filter '!./' --filter './packages/*'
```

Similarly, `bun outdated` will display outdated dependencies for all packages in the monorepo, and `--filter` can be used to restrict the command to a subset of the packages:

```bash
# Display outdated dependencies for workspaces starting with `pkg-`
$ bun outdated --filter 'pkg-*'

# Display outdated dependencies for only the root package.json
$ bun outdated --filter './'
```

For more information on both these commands, see [`bun install`](https://bun.sh/docs/cli/install) and [`bun outdated`](https://bun.sh/docs/cli/outdated).

## Running scripts with `--filter`

Use the `--filter` flag to execute scripts in multiple packages at once:

```bash
bun --filter <pattern> <script>
```

Say you have a monorepo with two packages: `packages/api` and `packages/frontend`, both with a `dev` script that will start a local development server. Normally, you would have to open two separate terminal tabs, cd into each package directory, and run `bun dev`:

```bash
cd packages/api
bun dev

# in another terminal
cd packages/frontend
bun dev
```

Using `--filter`, you can run the `dev` script in both packages at once:

```bash
bun --filter '*' dev
```

Both commands will be run in parallel, and you will see a nice terminal UI showing their respective outputs:
![Terminal Output](https://github.com/oven-sh/bun/assets/48869301/2a103e42-9921-4c33-948f-a1ad6e6bac71)

### Running scripts in workspaces

Filters respect your [workspace configuration](https://bun.sh/docs/install/workspaces): If you have a `package.json` file that specifies which packages are part of the workspace,
`--filter` will be restricted to only these packages. Also, in a workspace you can use `--filter` to run scripts in packages that are located anywhere in the workspace:

```bash
# Packages
# src/foo
# src/bar

# in src/bar: runs myscript in src/foo, no need to cd!
bun run --filter foo myscript
```

### Dependency Order

Bun will respect package dependency order when running scripts. Say you have a package `foo` that depends on another package `bar` in your workspace, and both packages have a `build` script. When you run `bun --filter '*' build`, you will notice that `foo` will only start running once `bar` is done.
