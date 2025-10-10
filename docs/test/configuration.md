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

### Test execution

#### concurrentTestGlob

Automatically run test files matching a glob pattern with concurrent test execution enabled. This is useful for gradually migrating test suites to concurrent execution or for running specific test types concurrently.

```toml
[test]
concurrentTestGlob = "**/concurrent-*.test.ts"  # Run files matching this pattern concurrently
```

Test files matching this pattern will behave as if the `--concurrent` flag was passed, running all tests within those files concurrently. This allows you to:

- Gradually migrate your test suite to concurrent execution
- Run integration tests concurrently while keeping unit tests sequential
- Separate fast concurrent tests from tests that require sequential execution

The `--concurrent` CLI flag will override this setting when specified, forcing all tests to run concurrently regardless of the glob pattern.

#### randomize

Run tests in random order to identify tests with hidden dependencies:

```toml
[test]
randomize = true
```

#### seed

Specify a seed for reproducible random test order. Requires `randomize = true`:

```toml
[test]
randomize = true
seed = 2444615283
```

#### rerunEach

Re-run each test file multiple times to identify flaky tests:

```toml
[test]
rerunEach = 3
```

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

#### coveragePathIgnorePatterns

Exclude specific files or file patterns from coverage reports using glob patterns:

```toml
[test]
# Single pattern
coveragePathIgnorePatterns = "**/*.spec.ts"

# Multiple patterns
coveragePathIgnorePatterns = [
  "**/*.spec.ts",
  "**/*.test.ts",
  "src/utils/**",
  "*.config.js"
]
```

Files matching any of these patterns will be excluded from coverage calculation and reporting. See the [coverage documentation](./coverage.md) for more details and examples.

#### coverageIgnoreSourcemaps

Internally, Bun transpiles every file. That means code coverage must also go through sourcemaps before they can be reported. We expose this as a flag to allow you to opt out of this behavior, but it will be confusing because during the transpilation process, Bun may move code around and change variable names. This option is mostly useful for debugging coverage issues.

```toml
[test]
coverageIgnoreSourcemaps = true  # Don't use sourcemaps for coverage analysis
```

When using this option, you probably want to stick a `// @bun` comment at the top of the source file to opt out of the transpilation process.

### Install settings inheritance

The `bun test` command inherits relevant network and installation configuration (registry, cafile, prefer, exact, etc.) from the `[install]` section of bunfig.toml. This is important if tests need to interact with private registries or require specific install behaviors triggered during the test run.
