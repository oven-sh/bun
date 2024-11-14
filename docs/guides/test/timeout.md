---
name: Set a per-test timeout with the Bun test runner
---

Use the `--timeout` flag to set a timeout for each test in milliseconds. If any test exceeds this timeout, it will be marked as failed.

The default timeout is `5000` (5 seconds).

```sh
$ bun test --timeout 3000 # 3 seconds
```

---

See [Docs > Test runner](https://bun.sh/docs/cli/test) for complete documentation of `bun test`.
