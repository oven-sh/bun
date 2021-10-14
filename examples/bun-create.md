# `bun create`

## Config

The `bun-create` section of package.json is automatically removed from the final output. This lets you add create-only steps without installing an extra package.

There are currently two options:

- `postinstall`
- `preinstall`

They can be an array of strings or one string. An array of strings will be executed one after another.

Here are examples:

```
{
  "name": "@bun-examples/next",
  "version": "0.0.31",
  "main": "index.js",
  "dependencies": {
    "next": "11.1.2",
    "react": "^17.0.2",
    "react-dom": "^17.0.2",
    "react-is": "^17.0.2"
  },
  "devDependencies": {
    "@types/react": "^17.0.19",
    "bun-framework-next": "^0.0.0-21",
    "typescript": "^4.3.5"
  },
  "bun-create": {
    "postinstall": [
      "bun bun --use next"
    ]
  }
}
```

By default, all commands run inside the environment exposed by the auto-detected npm client. This incurs a significant performance penalty, something like 150ms wasted on waiting for the npm client to start on each invocation.

Any command that starts with `"bun "` will be run without npm.

## How it works

When you run `bun create ${template} ${destination}`, here's what happens:

1. GET `registry.npmjs.org/@bun-examples/${template}/latest` and parse it
2. GET `registry.npmjs.org/@bun-examples/${template}/-/${template}-${latestVersion}.tgz`
3. Decompress & extract `${template}-${latestVersion}.tgz` into `${destination}`
   3a. If there are files that would overwrite, warn and exit unless `--force` is passed
4. Parse the `package.json` (again!), update `name` to be `${basename(destination)}`, remove the `bun-create` section from the `package.json` and save updated `package.json` to disk
5. Auto-detect the npm client, preferring `pnpm`, `yarn` (v1), and lastly `npm`
6. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
7. Run `${npmClient} install`
8. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
9. Run `git init; git add -A .; git commit -am "Initial Commit";`.
   8a. Rename `gitignore` to `.gitignore`. NPM automatically removes `.gitignore` files from appearing in packages.
10. Done

`../misctools/publish-examples.js` publishes all examples to npm.
