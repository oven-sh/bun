`bun:test` supports seeing which lines of code are covered by tests. To use this feature, pass `--coverage` to the CLI:

```sh
bun test --coverage
```

It will print out a coverage report to the console:

```js
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

If coverage is below a threshold, `bun:test` will exit with a non-zero exit code to indicate the failure.

### Configuring coverage

`bunfig.toml` supports configuring coverage:

```toml
[test]

# Always enable coverage
coverage = true

# Anything less than 90% coverage will fail the test
# coverageThreshold = 0.9
coverageThreshold = { line = 0.9, function = 0.9 }


# Don't include .test.* files in coverage reports
coverageSkipTestFiles = true

# Disable sourcemap support in coverage reports
# By default, coverage reports will automatically use Bun's internal sourcemap.
# You probably don't want to configure this
# coverageIgnoreSourcemaps = false
```

`coverageThreshold` can be either a number or an object with `line` and `function` keys. When a number, it is treated as both the line and function threshold.

Coverage support was added in Bun v0.7.3.
