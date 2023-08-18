Bun's test runner includes a built-in test coverage reporter.

## Enabling coverage

`bun:test` supports seeing which lines of code are covered by tests. To use this feature, pass `--coverage` to the CLI. It will print out a coverage report to the console:

```js
$ bun test --coverage
-------------|---------|---------|-------------------
File         | % Funcs | % Lines | Uncovered Line #s
-------------|---------|---------|-------------------
All files    |   38.89 |   42.11 |
 index-0.ts  |   33.33 |   36.84 | 10-15,19-24
 index-1.ts  |   33.33 |   36.84 | 10-15,19-24
 index-10.ts |   33.33 |   36.84 | 10-15,19-24
 index-2.ts  |   33.33 |   36.84 | 10-15,19-24
 index-3.ts  |   33.33 |   36.84 | 10-15,19-24
 index-4.ts  |   33.33 |   36.84 | 10-15,19-24
 index-5.ts  |   33.33 |   36.84 | 10-15,19-24
 index-6.ts  |   33.33 |   36.84 | 10-15,19-24
 index-7.ts  |   33.33 |   36.84 | 10-15,19-24
 index-8.ts  |   33.33 |   36.84 | 10-15,19-24
 index-9.ts  |   33.33 |   36.84 | 10-15,19-24
 index.ts    |  100.00 |  100.00 |
-------------|---------|---------|-------------------
```

To always enable coverage reporting by default, add the following line to your `bunfig.toml`:

```toml
[test]

# always enable coverage
coverage = true
```

By default coverage reports will _include_ test files and _exclude_ sourcemaps. This is usually what you want, but it can be configured otherwise in `bunfig.toml`.

```toml
coverageSkipTestFiles = true       # default false
coverageIgnoreSourcemaps = false   # default true
```

### Coverage thresholds

{% callout %}
**Note** — Support for coverage reporting was added in Bun v0.7.3.
{% /callout %}

It is possible to specify a coverage threshold in `bunfig.toml`. If your test suite does not meet or exceed this threshold, `bun test` will exit with a non-zero exit code to indicate the failure.

```toml
[test]

# to require 90% line-level and function-level coverage
coverageThreshold = 0.9

# to set different thresholds for lines and functions
coverageThreshold = { line = 0.9, function = 0.9 }
```
