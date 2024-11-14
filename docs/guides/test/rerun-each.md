---
name: Re-run tests multiple times with the Bun test runner
---

Use the `--rerun-each` flag to re-run every test multiple times with the Bun test runner. This is useful for finding flaky or non-deterministic tests.

```sh
# re-run each test 10 times
$ bun test --rerun-each 10
```

---

See [Docs > Test runner](https://bun.sh/docs/cli/test) for complete documentation of `bun test`.
