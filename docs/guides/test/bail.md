---
name: Bail early with the Bun test runner
---

Use the `--bail` flag to bail on a test run after a single failure. This is useful for aborting as soon as possible in a continuous integration environment.

```sh
$ bun test --bail
```

---

To bail after a certain threshold of failures, optionally specify a number after the flag.

```sh
# bail after 10 failures
$ bun test --bail 10
```

---

See [Docs > Test runner](https://bun.sh/docs/cli/test) for complete documentation of `bun test`.
