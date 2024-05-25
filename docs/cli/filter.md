Use the `--filter` flag to execute lifecycle scripts in multiple packages at once:

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


## Matching

`--filter` accepts a pattern to match specific packages, either by name or by path. Patterns have full support for glob syntax.

### Package Name `--filter <pattern>`

Name patterns select packages based on the package name, as specified in `package.json`. For example, if you have packages `pkga`, `pkgb` and `other`, you can match all packages with `*`, only `pkga` and `pkgb` with `pkg*`, and a specific package by providing the full name of the package.

### Package Path `--filter ./<glob>`

Path patterns are specified by starting the pattern with `./`, and will select all packages in directories that match the pattern. For example, to match all packages in subdirectories of `packages`, you can use `--filter './packages/**'`. To match a package located in `pkgs/foo`, use `--filter ./pkgs/foo`.

## Workspaces

Filters respect your [workspace configuration](/docs/install/workspaces): If you have a `package.json` file that specifies which packages are part of the workspace,
`--filter` will be restricted to only these packages. Also, in a workspace you can use `--filter` to run scripts in packages that are located anywhere in the workspace:

```bash
# Packages
# src/foo
# src/bar

# in src/bar: runs myscript in src/foo, no need to cd!
bun run --filter foo myscript
```

## Dependency Order
Bun will respect package dependency order when running scripts. Say you have a package `foo` that depends on another package `bar` in your workspace, and both packages have a `build` script. When you run `bun --filter '*' build`, you will notice that `foo` will only start running once `bar` is done.

### Cyclic Dependencies

