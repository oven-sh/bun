bun test supports different output formats through reporters. This document covers both built-in reporters and how to implement your own custom reporters.

## Built-in Reporters

### Default Console Reporter

By default, bun test outputs results to the console in a human-readable format:

```sh
test/package-json-lint.test.ts:
✓ test/package.json [0.88ms]
✓ test/js/third_party/grpc-js/package.json [0.18ms]
✓ test/js/third_party/svelte/package.json [0.21ms]
✓ test/js/third_party/express/package.json [1.05ms]

 4 pass
 0 fail
 4 expect() calls
Ran 4 tests in 1.44ms
```

When a terminal doesn't support colors, the output avoids non-ascii characters:

```sh
test/package-json-lint.test.ts:
(pass) test/package.json [0.48ms]
(pass) test/js/third_party/grpc-js/package.json [0.10ms]
(pass) test/js/third_party/svelte/package.json [0.04ms]
(pass) test/js/third_party/express/package.json [0.04ms]

 4 pass
 0 fail
 4 expect() calls
Ran 4 tests across 1 files. [0.66ms]
```

### JUnit XML Reporter

For CI/CD environments, Bun supports generating JUnit XML reports. JUnit XML is a widely-adopted format for test results that can be parsed by many CI/CD systems, including GitLab, Jenkins, and others.

#### Using the JUnit Reporter

To generate a JUnit XML report, use the `--reporter=junit` flag along with `--reporter-outfile` to specify the output file:

```sh
$ bun test --reporter=junit --reporter-outfile=./junit.xml
```

This continues to output to the console as usual while also writing the JUnit XML report to the specified path at the end of the test run.

#### Configuring via bunfig.toml

You can also configure the JUnit reporter in your `bunfig.toml` file:

```toml
[test.reporter]
junit = "path/to/junit.xml"  # Output path for JUnit XML report
```

#### Environment Variables in JUnit Reports

The JUnit reporter automatically includes environment information as `<properties>` in the XML output. This can be helpful for tracking test runs in CI environments.

Specifically, it includes the following environment variables when available:

| Environment Variable                                                    | Property Name | Description            |
| ----------------------------------------------------------------------- | ------------- | ---------------------- |
| `GITHUB_RUN_ID`, `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `CI_JOB_URL` | `ci`          | CI build information   |
| `GITHUB_SHA`, `CI_COMMIT_SHA`, `GIT_SHA`                                | `commit`      | Git commit identifiers |
| System hostname                                                         | `hostname`    | Machine hostname       |

This makes it easier to track which environment and commit a particular test run was for.

#### Current Limitations

The JUnit reporter currently has a few limitations that will be addressed in future updates:

- `stdout` and `stderr` output from individual tests are not included in the report
- Precise timestamp fields per test case are not included

### GitHub Actions reporter

Bun test automatically detects when it's running inside GitHub Actions and emits GitHub Actions annotations to the console directly. No special configuration is needed beyond installing Bun and running `bun test`.

For a GitHub Actions workflow configuration example, see the [CI/CD integration](../cli/test.md#cicd-integration) section of the CLI documentation.

## Custom Reporters

Bun allows developers to implement custom test reporters by extending the WebKit Inspector Protocol with additional testing-specific domains.

### Inspector Protocol for Testing

To support test reporting, Bun extends the standard WebKit Inspector Protocol with two custom domains:

1. **TestReporter**: Reports test discovery, execution start, and completion events
2. **LifecycleReporter**: Reports errors and exceptions during test execution

These extensions allow you to build custom reporting tools that can receive detailed information about test execution in real-time.

### Key Events

Custom reporters can listen for these key events:

- `TestReporter.found`: Emitted when a test is discovered
- `TestReporter.start`: Emitted when a test starts running
- `TestReporter.end`: Emitted when a test completes
- `Console.messageAdded`: Emitted when console output occurs during a test
- `LifecycleReporter.error`: Emitted when an error or exception occurs
