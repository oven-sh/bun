---
name: Install and run Playwright in GitHub Actions
---

[Playwright](https://github.com/microsoft/playwright) is a powerful tool for browser automation. It's a popular choice for testing web applications end-to-end.

First, use the official [`setup-bun`](https://github.com/oven-sh/setup-bun) GitHub Action to install `bun` in your GitHub Actions runner.

Then, use the `bunx` command to install Playwright binaries. Playwright needs these browser binaries to actually run tests.

```yaml-diff#workflow.yml
name: my-workflow
jobs:
  my-job:
    name: my-job
    runs-on: macos-latest
    steps:
      # ...
      - uses: actions/checkout@v4
+     - uses: oven-sh/setup-bun@v2

      # first install any project dependencies, like `@playwright/test`
+     - run: bun install

+     - name: Install Playwright binaries
+       run: bunx playwright install --with-deps

+     - name: Run e2e tests
+       run: bun run test:e2e
```

---

To speed up CI runs, you can cache the Playwright binaries for subsequent runs.

Use the official GitHub Action [`actions/cache`](https://github.com/actions/cache) to cache the Playwright binaries.

This is how GitHub actions cache works:

1. The cache key for Playwright binaries is generated based on the `path` and `key` arguments.
2. If the cache is hit, the `steps.playwright-cache.outputs.cache-hit` output is set to `"true"`. The step to install Playwright binaries is skipped.
3. If the cache is not hit, the `steps.playwright-cache.outputs.cache-hit` output is set to `"false"`. The step to install Playwright binaries is run.

It's important to generate the cache key using a file that reflects changes to project dependencies. For example, if a new Playwright version is installed, or if other dependencies are installed, the cache key should be updated, and the binaries re-installed.

Refer to the [GitHub Actions Cache documentation](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/caching-dependencies-to-speed-up-workflows) for more information.


```yaml-diff#workflow.yml
name: my-workflow
jobs:
  my-job:
    name: my-job
    runs-on: macos-latest
    steps:
      # ...
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

+     - uses: actions/cache@v4
+       id: playwright-cache
+       with:
+         path: /Users/runner/Library/Caches/ms-playwright
+         key: ${{ runner.os }}-playwright-${{ hashFiles('**/bun.lock') }}

      # first install any project dependencies, like `@playwright/test`
      - run: bun install

      - name: Install Playwright binaries
        run: bunx playwright install --with-deps
+       # skip this step if cache is hit
+       if: steps.playwright-cache.outputs.cache-hit != 'true'

      - name: Run e2e tests
        run: bun run test:e2e
```