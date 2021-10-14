# bun create

`bun create` is a fast way to create a new project from a template. At the time of writing, `bun create react app` runs ~14x faster on my local computer than `yarn create react-app app`. `bun create` currently does no caching (though your npm client does)

## Usage

Templates are downloaded from folders inside `examples/` in Bun's GitHub repo. Running `bun create react ./local-path` downloads the `react` folder from `examples/react`.

Create a new Next.js project:

```bash
bun create next ./app`
```

Create a new React project:

```bash
bun create react ./app
```

To see a list of available templates, run

```bash
bun create
```

### Advanced

| Flag                   | Description                            |
| ---------------------- | -------------------------------------- |
| --npm                  | Use `npm` for tasks & install          |
| --yarn                 | Use `yarn` for tasks & install         |
| --pnpm                 | Use `pnpm` for tasks & install         |
| --force                | Overwrite existing files               |
| --no-install           | Skip installing `node_modules` & tasks |
| --no-git               | Don't initialize a git repository      |
| ---------------------- | -----------------------------------    |

By default, `bun create` will cancel if there are existing files it would overwrite. You can pass `--force` to disable this behavior.

## Adding a new template

Clone this repository and a new folder in `examples/` with your new template. The `package.json` must have a `name` that starts with `@bun-examples/`. Do not worry about publishing it, that will happen automaticallly after the PR is merged.

Make sure to include a `.gitignore` that includes `node_modules` so that `node_modules` aren't checked in to git when people download the template.

#### Testing your new template

### Config

The `bun-create` section of package.json is automatically removed from the `package.json` on disk. This lets you add create-only steps without waiting for an extra package to install.

There are currently two options:

- `postinstall`
- `preinstall`

They can be an array of strings or one string. An array of steps will be executed in order.

Here is an example:

```json
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
    "postinstall": ["bun bun --use next"]
  }
}
```

By default, all commands run inside the environment exposed by the auto-detected npm client. This incurs a significant performance penalty, something like 150ms spent waiting for the npm client to start on each invocation.

Any command that starts with `"bun "` will be run without npm, relying on the first `bun` binary in `$PATH`.

## How `bun create` works

When you run `bun create ${template} ${destination}`, here's what happens:

1. GET `registry.npmjs.org/@bun-examples/${template}/latest` and parse it
2. GET `registry.npmjs.org/@bun-examples/${template}/-/${template}-${latestVersion}.tgz`
3. Decompress & extract `${template}-${latestVersion}.tgz` into `${destination}`

   - If there are files that would overwrite, warn and exit unless `--force` is passed

4. Parse the `package.json` (again!), update `name` to be `${basename(destination)}`, remove the `bun-create` section from the `package.json` and save updated `package.json` to disk
5. Auto-detect the npm client, preferring `pnpm`, `yarn` (v1), and lastly `npm`
6. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
7. Run `${npmClient} install`
8. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
9. Run `git init; git add -A .; git commit -am "Initial Commit";`.

   - Rename `gitignore` to `.gitignore`. NPM automatically removes `.gitignore` files from appearing in packages.

10. Done

`../misctools/publish-examples.js` publishes all examples to npm.
