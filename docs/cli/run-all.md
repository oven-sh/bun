# bun run --all

The `--all` flag for `bun run` enables sequential execution of multiple package.json scripts or source files, providing a drop-in replacement for popular tools like `npm-run-all`.

## Syntax

```bash
bun run --all <target1> <target2> [target3] ...
```

or

```bash
bun --all <target1> <target2> [target3] ...
```

## Features

### Sequential Execution

The `--all` flag runs each target sequentially (one after another), not in parallel:

```bash
bun run --all clean build test
```

This will run:
1. `clean` script
2. `build` script (after clean completes)
3. `test` script (after build completes)

### Pattern Matching

The flag supports pattern matching using `:*` and `:` suffixes to match multiple scripts:

#### Using `:*` suffix

```bash
bun run --all "test:*"
```

Matches all scripts starting with `test:`:
- `test:unit`
- `test:integration`
- `test:e2e`

#### Using `:` suffix

```bash
bun run --all "build:"
```

Equivalent to `build:*`, matches all scripts starting with `build:`:
- `build:dev`
- `build:prod`
- `build:staging`

### Mixed Targets

You can mix script names, patterns, and file paths:

```bash
bun run --all clean "test:*" ./scripts/deploy.js
```

## Examples

### Basic Usage

```json
{
  "scripts": {
    "clean": "rm -rf dist/",
    "build": "tsc",
    "test": "jest"
  }
}
```

```bash
# Run all scripts in sequence
bun run --all clean build test
```

### Pattern Matching

```json
{
  "scripts": {
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration",
    "test:e2e": "playwright test",
    "build:lib": "tsc -p tsconfig.lib.json",
    "build:app": "vite build"
  }
}
```

```bash
# Run all test scripts
bun run --all "test:*"

# Run all build scripts
bun run --all "build:*"

# Mix patterns and explicit scripts
bun run --all clean "build:*" "test:*"
```

### Real-world Build Pipeline

```json
{
  "scripts": {
    "clean": "rimraf dist coverage",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit",
    "build:lib": "rollup -c",
    "build:docs": "typedoc",
    "test:unit": "vitest run",
    "test:integration": "playwright test"
  }
}
```

```bash
# Complete CI pipeline
bun run --all clean lint typecheck "build:*" "test:*"
```

### Running Files

```bash
# Run multiple JavaScript files
bun run --all ./scripts/setup.js ./scripts/build.js ./scripts/deploy.js

# Mix scripts and files
bun run --all clean ./scripts/custom-build.js test
```

## Error Handling

### Failure Behavior

When a target fails:
- The command continues executing remaining targets
- The overall command exits with a non-zero status
- Error details are displayed for failed targets

```bash
bun run --all success1 failing-script success2
# Output: success1 runs, failing-script fails, success2 still runs
# Exit code: non-zero
```

### Missing Targets

If a target doesn't exist:
- An error is reported for that target
- Execution continues with remaining targets
- Overall command fails

### Pattern Matching Edge Cases

If a pattern matches no scripts:
- An error is reported
- The command fails immediately

```bash
bun run --all "nonexistent:*"
# Error: No targets found matching the given patterns
```

## npm-run-all Compatibility

The `--all` flag is designed as a drop-in replacement for `npm-run-all`:

### npm-run-all
```bash
npm-run-all clean build test
npm-run-all "test:*"
npm-run-all --serial clean build test
```

### bun equivalent
```bash
bun run --all clean build test
bun run --all "test:*"
bun run --all clean build test  # always serial
```

## Implementation Notes

### Current Limitations

- **Sequential Only**: The current implementation runs targets sequentially. Parallel execution may be added in future versions.
- **Pattern Expansion**: Patterns are expanded against package.json scripts. More complex glob patterns are not currently supported.
- **Workspace Support**: Workspace-aware execution is planned for future versions.

### Future Enhancements

The implementation is designed to easily support:
- Parallel execution with `--parallel` flag
- Advanced glob patterns
- Workspace package filtering
- Output formatting options

## Migration from npm-run-all

To migrate from `npm-run-all` to `bun run --all`:

1. Replace `npm-run-all` with `bun run --all`
2. Remove `--serial` flag (always sequential)
3. Keep existing pattern syntax unchanged
4. Update CI/build scripts accordingly

### Before
```json
{
  "scripts": {
    "build": "npm-run-all clean lint build:*",
    "test": "npm-run-all --serial test:unit test:integration"
  }
}
```

### After
```json
{
  "scripts": {
    "build": "bun run --all clean lint build:*",
    "test": "bun run --all test:unit test:integration"
  }
}
```