Configure `bun test` via `bunfig.toml` file and command-line options. This page documents the available configuration options for `bun test`.

## bunfig.toml options

You can configure `bun test` behavior by adding a `[test]` section to your `bunfig.toml` file:

```toml
[test]
# Options go here
```

### Test discovery

#### root

The `root` option specifies a root directory for test discovery, overriding the default behavior of scanning from the project root.

```toml
[test]
root = "src"  # Only scan for tests in the src directory
```

### Reporters

#### reporter.junit

Configure the JUnit reporter output file path directly in the config file:

```toml
[test.reporter]
junit = "path/to/junit.xml"  # Output path for JUnit XML report
```

This complements the `--reporter=junit` and `--reporter-outfile` CLI flags.

### Memory usage

#### smol

Enable the `--smol` memory-saving mode specifically for the test runner:

```toml
[test]
smol = true  # Reduce memory usage during test runs
```

This is equivalent to using the `--smol` flag on the command line.

### Coverage options

In addition to the options documented in the [coverage documentation](./coverage.md), the following options are available:

#### coverageSkipTestFiles

Exclude files matching test patterns (e.g., \*.test.ts) from the coverage report:

```toml
[test]
coverageSkipTestFiles = true  # Exclude test files from coverage reports
```

#### coverageThreshold (Object form)

The coverage threshold can be specified either as a number (as shown in the coverage documentation) or as an object with specific thresholds:

```toml
[test]
# Set specific thresholds for different coverage metrics
coverageThreshold = { lines = 0.9, functions = 0.8, statements = 0.85 }
```

Setting any of these enables `fail_on_low_coverage`, causing the test run to fail if coverage is below the threshold.

#### coverageIgnoreSourcemaps

Internally, Bun transpiles every file. That means code coverage must also go through sourcemaps before they can be reported. We expose this as a flag to allow you to opt out of this behavior, but it will be confusing because during the transpilation process, Bun may move code around and change variable names. This option is mostly useful for debugging coverage issues.

```toml
[test]
coverageIgnoreSourcemaps = true  # Don't use sourcemaps for coverage analysis
```

When using this option, you probably want to stick a `// @bun` comment at the top of the source file to opt out of the transpilation process.

### Install settings inheritance

The `bun test` command inherits relevant network and installation configuration (registry, cafile, prefer, exact, etc.) from the `[install]` section of bunfig.toml. This is important if tests need to interact with private registries or require specific install behaviors triggered during the test run.
