---
name: Install dependencies with Bun in GitHub Actions
---

Use the official [`setup-bun`](https://github.com/oven-sh/setup-bun) GitHub Action to install `bun` in your GitHub Actions runner.

```yaml-diff#workflow.yml
name: my-workflow
jobs:
  my-job:
    name: my-job
    runs-on: ubuntu-latest
    steps:
      # ...
      - uses: actions/checkout@v4
+     - uses: oven-sh/setup-bun@v2

      # run any `bun` or `bunx` command
+     - run: bun install
```

---

To specify a version of Bun to install:

```yaml-diff#workflow.yml
name: my-workflow
jobs:
  my-job:
    name: my-job
    runs-on: ubuntu-latest
    steps:
      # ...
      - uses: oven-sh/setup-bun@v2
+       with:
+         version: "latest" # or "canary"
```

---

Alternatively, you can define the Bun version in the `.bun-version` file, which should be committed to your repository.

The `setup-bun` action will read the version from the `.bun-version` file.

```
# .bun-version
latest
```

You can customize the path of the file using the `bun-version-file` option for the `setup-bun` action.

```yaml-diff#workflow.yml
name: my-workflow
jobs:
  my-job:
    name: my-job
    runs-on: ubuntu-latest
    steps:
      # ...
      - uses: oven-sh/setup-bun@v2
+       with:
+         bun-version-file: "src/.bun-version"
```

---

Refer to the [README.md](https://github.com/oven-sh/setup-bun) for complete documentation of the `setup-bun` GitHub Action.
