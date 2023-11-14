---
name: Install and run Bun in GitHub Actions
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
      - uses: actions/checkout@v3
+     - uses: oven-sh/setup-bun@v1

      # run any `bun` or `bunx` command
+     - run: bun install
+     - run: bun index.ts
+     - run: bun run build
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
      - uses: oven-sh/setup-bun@v1
+       with:
+         bun-version: 1.0.11 # or "latest", "canary", <sha>
```

---

Refer to the [README.md](https://github.com/oven-sh/setup-bun) for complete documentation of the `setup-bun` GitHub Action.
