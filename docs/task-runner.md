## Using bun as a task runner

Instead of waiting 170ms for your npm client to start for each task, you wait 6ms for bun.

To use bun as a task runner, run `bun run` instead of `npm run`.

```bash
# Instead of "npm run clean"
bun run clean

# This also works
bun clean
```

Assuming a package.json with a `"clean"` command in `"scripts"`:

```json
{
  "name": "myapp",
  "scripts": {
    "clean": "rm -rf dist out node_modules"
  }
}
```
