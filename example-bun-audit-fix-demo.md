# Bun Audit Fix Demo

This demonstrates the new `bun audit --fix` command that automatically fixes security vulnerabilities.

## Example 1: Fixing a Vulnerable Package

Let's say you have a project with a vulnerable version of `ms`:

```json
// package.json
{
  "name": "my-project",
  "version": "1.0.0",
  "dependencies": {
    "ms": "0.7.0" // This version has known vulnerabilities
  }
}
```

### Before: Manual Process

Previously, you had to:

1. Run `bun audit` to identify vulnerabilities
2. Manually look up safe versions
3. Run `bun update ms` or edit package.json manually
4. Verify the fix worked

### Now: Automatic Fix

```bash
$ bun audit --fix

bun audit v1.1.42

Analyzing vulnerabilities...

Fixing 1 vulnerable packages...

✓ Fixed 1 vulnerabilities

Run bun audit again to verify all vulnerabilities are resolved
```

The command automatically:

- Identifies vulnerable packages
- Finds the minimum safe version
- Updates your package.json
- Reinstalls dependencies

## Example 2: Handling Multiple Vulnerabilities

If you have multiple vulnerable packages:

```bash
$ bun audit
bun audit v1.1.42

ms  <2.0.0
  critical: Regular Expression Denial of Service - https://github.com/advisories/GHSA-example1

debug  <2.6.9
  high: Inefficient Regular Expression Complexity - https://github.com/advisories/GHSA-example2

mime  <1.4.1
  moderate: Regular Expression Denial of Service - https://github.com/advisories/GHSA-example3

3 vulnerabilities (1 critical, 1 high, 1 moderate)

To update all dependencies to the latest compatible versions:
  bun update

To update all dependencies to the latest versions (including breaking changes):
  bun update --latest
```

Now you can fix them all at once:

```bash
$ bun audit --fix

bun audit v1.1.42

Analyzing vulnerabilities...

Fixing 3 vulnerable packages...

✓ Fixed 3 vulnerabilities

Run bun audit again to verify all vulnerabilities are resolved
```

## Example 3: When Fixes Aren't Possible

Sometimes a package might not have a safe version available:

```bash
$ bun audit --fix

bun audit v1.1.42

Analyzing vulnerabilities...

No vulnerabilities can be automatically fixed
```

In this case, you might need to:

- Wait for the package maintainer to release a fix
- Consider using an alternative package
- Use `bun update --latest` to try major version updates

## Integration with CI/CD

You can use this in your CI pipeline to automatically fix vulnerabilities:

```yaml
# .github/workflows/security.yml
name: Security Audit
on:
  schedule:
    - cron: "0 0 * * 1" # Weekly on Monday

jobs:
  audit-fix:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Fix vulnerabilities
        run: bun audit --fix

      - name: Create PR if changes
        uses: peter-evans/create-pull-request@v5
        with:
          title: "Fix security vulnerabilities"
          commit-message: "fix: update vulnerable dependencies"
          branch: security-fixes
```

## Command Options

- `bun audit` - Check for vulnerabilities (no changes)
- `bun audit --json` - Output vulnerabilities as JSON
- `bun audit --fix` - Automatically fix vulnerabilities
- `bun audit --json --fix` - JSON output takes precedence (no fixes applied)

## Benefits

1. **Speed**: Fix all vulnerabilities with one command
2. **Safety**: Updates to minimum safe version, not latest
3. **Precision**: Only updates vulnerable packages
4. **Compatibility**: Respects your existing version constraints when possible

This feature brings Bun to parity with `npm audit fix` while leveraging Bun's speed and efficiency.
