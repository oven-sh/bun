---
name: Generate code coverage reports with the Bun test runner
---

Bun's test runner supports built-in _code coverage reporting_. This makes it easy to see how much of the codebase is covered by tests and find areas that are not currently well-tested.

---

Pass the `--coverage` flag to `bun test` to enable this feature. This will print a coverage report after the test run.

The coverage report lists the source files that were executed during the test run, the percentage of functions and lines that were executed, and the line ranges that were not executed during the run.

```sh
$ bun test --coverage

test.test.ts:
✓ math > add [0.71ms]
✓ math > multiply [0.03ms]
✓ random [0.13ms]
-------------|---------|---------|-------------------
File         | % Funcs | % Lines | Uncovered Line #s
-------------|---------|---------|-------------------
All files    |   66.67 |   77.78 |
 math.ts     |   50.00 |   66.67 |
 random.ts   |   50.00 |   66.67 |
-------------|---------|---------|-------------------

 3 pass
 0 fail
 3 expect() calls
```

---

To always enable coverage reporting by default, add the following line to your `bunfig.toml`:

```toml
[test]
coverage = true # always enable coverage
```

---

Refer to [Docs > Test runner > Coverage](/docs/test/coverage) for complete documentation on code coverage reporting in Bun.
