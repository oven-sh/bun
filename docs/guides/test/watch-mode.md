---
name: Run tests in watch mode with Bun
---

Use the `--watch` flag to run your tests in watch mode.

```sh
$ bun test --watch
```

---

This will restart the running Bun process whenever a file change is detected. It's fast. In this example, the editor is configured to save the file on every keystroke.

{% image src="https://github.com/oven-sh/bun/assets/3084745/dc49a36e-ba82-416f-b960-1c883a924248" caption="Running tests in watch mode in Bun" /%}

---

See [Docs > Test Runner](https://bun.sh/docs/cli/test) for complete documentation on the test runner.
