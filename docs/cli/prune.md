---
name: bun prune
---

The `bun prune` command removes extraneous packages from your project's `node_modules` directory. Extraneous packages are those that are installed but not declared as dependencies in your `package.json` or referenced in your lockfile.

```bash
$ bun prune
```

This command is useful for:
- Cleaning up packages that were manually installed but never added to `package.json`
- Removing leftover packages after removing dependencies
- Ensuring your `node_modules` directory only contains necessary packages
- Reducing disk space usage by removing unused packages

## How it works

`bun prune` analyzes your project's lockfile (`bun.lockb` or `bun.lock`) to determine which packages should be present in `node_modules`, then removes any packages that aren't referenced.

The command:
1. Reads your project's lockfile to identify legitimate packages
2. Scans the `node_modules` directory for installed packages
3. Removes any packages not found in the lockfile
4. Handles both regular packages (`package-name`) and scoped packages (`@scope/package-name`)
5. Reports the number of packages removed

## Usage

```bash
# Remove extraneous packages
$ bun prune

# Show help
$ bun prune --help
```

## Examples

### Basic usage

```bash
$ bun prune
bun prune v1.2.21

Removing lodash
Removing @types/unused-package  
Removed 2 extraneous packages
Pruned extraneous packages
```

### No extraneous packages

```bash
$ bun prune
bun prune v1.2.21

Pruned extraneous packages
```

### Missing lockfile

```bash
$ bun prune
bun prune v1.2.21

error: Lockfile not found
```

## When to use `bun prune`

### After removing dependencies

When you remove a dependency with `bun remove`, the package is removed from `package.json` and the lockfile, but may still exist in `node_modules`. Use `bun prune` to clean it up:

```bash
$ bun remove lodash
$ bun prune  # Remove lodash from node_modules if still present
```

### After manual package installation

If you manually installed packages without adding them to `package.json`:

```bash
$ cd node_modules && npm install some-package  # Manual install
$ bun prune  # Will remove some-package since it's not in package.json
```

### Before deployment

Clean up your dependencies before deploying to ensure only necessary packages are included:

```bash
$ bun install
$ bun prune
$ bun run build
```

### Disk space cleanup

Remove unused packages to free up disk space:

```bash
$ bun prune
Removed 15 extraneous packages
# Freed up several MB of disk space
```

## Error handling

### Missing package.json

```bash
$ bun prune
error: No package.json was found for directory "/path/to/project"

Note: Run "bun init" to initialize a project
```

### Missing lockfile

```bash
$ bun prune
error: Lockfile not found
```

Run `bun install` first to generate a lockfile:

```bash
$ bun install
$ bun prune
```

### No node_modules directory

If `node_modules` doesn't exist, `bun prune` succeeds without doing anything:

```bash
$ rm -rf node_modules
$ bun prune
bun prune v1.2.21

Pruned extraneous packages
```

## Comparison with other package managers

| Command | Behavior |
|---------|----------|
| `npm prune` | Removes extraneous packages not in `package.json` dependencies |
| `pnpm prune` | Removes orphaned packages not referenced by any dependency tree |
| `bun prune` | Removes packages not referenced in the lockfile |

`bun prune` is most similar to `npm prune` but uses Bun's lockfile as the source of truth rather than just `package.json`.

## Flags

Currently, `bun prune` doesn't support additional flags beyond `--help`. The command operates on the current working directory and uses the default log level for output.

## Technical details

- **Lockfile dependency**: Requires a valid lockfile (`bun.lockb` or `bun.lock`)
- **Package detection**: Scans `node_modules` directory structure
- **Scope handling**: Properly handles scoped packages under `@scope/` directories  
- **Safety**: Only removes packages not found in the lockfile
- **Performance**: Efficiently processes large `node_modules` directories

## Related commands

- [`bun install`](/docs/cli/install) - Install dependencies and generate lockfile
- [`bun remove`](/docs/cli/remove) - Remove dependencies from package.json
- [`bun add`](/docs/cli/add) - Add dependencies to package.json
- [`bun pm cache rm`](/docs/cli/pm#bun-pm-cache-rm) - Clear the global package cache