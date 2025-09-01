`bun audit` checks your installed packages for known security vulnerabilities.

Run the command in a project with a `bun.lock` file:

```bash
$ bun audit
```

Bun sends the list of installed packages and versions to NPM, and prints a report of any vulnerabilities that were found. Packages installed from registries other than the default registry are skipped.

If no vulnerabilities are found, the command prints:

```
No vulnerabilities found
```

When vulnerabilities are detected, each affected package is listed along with the severity, a short description and a link to the advisory. At the end of the report Bun prints a summary and hints for updating:

```
3 vulnerabilities (1 high, 2 moderate)
To update all dependencies to the latest compatible versions:
  bun update
To update all dependencies to the latest versions (including breaking changes):
  bun update --latest
```

## Options

### `--json`

Use the `--json` flag to print the raw JSON response from the registry instead of the formatted report:

```bash
$ bun audit --json
```

### `--audit-level`

Set the minimum severity level for reporting vulnerabilities. Vulnerabilities below this level will be ignored:

```bash
# Only report high and critical vulnerabilities
$ bun audit --audit-level high

# Report moderate and above (default)
$ bun audit --audit-level moderate

# Report all vulnerabilities including low severity
$ bun audit --audit-level low
```

Available levels: `low`, `moderate`, `high`, `critical`

### `--prod`

Only audit production dependencies, excluding devDependencies:

```bash
$ bun audit --prod
```

This is useful for checking only the dependencies that will be included in production builds.

### `--ignore`

Ignore specific vulnerabilities by their advisory ID:

```bash
# Ignore a single vulnerability
$ bun audit --ignore 1002548

# Ignore multiple vulnerabilities
$ bun audit --ignore 1002548,1003456,1004789
```

Use this flag to suppress known vulnerabilities that have been assessed as acceptable risks for your project.

## Exit code

`bun audit` will exit with code `0` if no vulnerabilities are found and `1` if the report lists any vulnerabilities. This will still happen even if `--json` is passed.
