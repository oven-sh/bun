{% callout %}
**Note** — You don’t need `bun create` to use Bun. You don’t need any configuration at all. This command exists to make getting started a bit quicker and easier.
{% /callout %}

Template a new Bun project with `bun create`. This is a flexible command that can be used to create a new project from a React component, a `create-<template>` npm package, a GitHub repo, or a local template.

If you're looking to create a brand new empty project, use [`bun init`](https://bun.sh/docs/cli/init).

## From a React component

`bun create ./MyComponent.tsx` turns an existing React component into a complete dev environment with hot reload and production builds in one command.

```bash
$ bun create ./MyComponent.jsx # .tsx also supported
```

{% raw %}

<video style="aspect-ratio: 2062 / 1344; width: 100%; height: 100%; object-fit: contain;"  loop autoplay muted playsinline>
  <source src="/bun-create-shadcn.mp4" style="width: 100%; height: 100%; object-fit: contain;" type="video/mp4">
</video>

{% /raw %}

{% callout %}
🚀 **Create React App Successor** — `bun create <component>` provides everything developers loved about Create React App, but with modern tooling, faster builds, and backend support.
{% /callout %}

#### How this works

When you run `bun create <component>`, Bun:

1. Uses [Bun's JavaScript bundler](https://bun.sh/docs/bundler) to analyze your module graph.
2. Collects all the dependencies needed to run the component.
3. Scans the exports of the entry point for a React component.
4. Generates a `package.json` file with the dependencies and scripts needed to run the component.
5. Installs any missing dependencies using [`bun install --only-missing`](https://bun.sh/docs/cli/install).
6. Generates the following files:
   - `${component}.html`
   - `${component}.client.tsx` (entry point for the frontend)
   - `${component}.css` (css file)
7. Starts a frontend dev server automatically.

### Using TailwindCSS with Bun

[TailwindCSS](https://tailwindcss.com/) is an extremely popular utility-first CSS framework used to style web applications.

When you run `bun create <component>`, Bun scans your JSX/TSX file for TailwindCSS class names (and any files it imports). If it detects TailwindCSS class names, it will add the following dependencies to your `package.json`:

```json#package.json
{
  "dependencies": {
    "tailwindcss": "^4",
    "bun-plugin-tailwind": "latest"
  }
}
```

We also configure `bunfig.toml` to use Bun's TailwindCSS plugin with `Bun.serve()`

```toml#bunfig.toml
[serve.static]
plugins = ["bun-plugin-tailwind"]
```

And a `${component}.css` file with `@import "tailwindcss";` at the top:

```css#MyComponent.css
@import "tailwindcss";
```

### Using `shadcn/ui` with Bun

[`shadcn/ui`](https://ui.shadcn.com/) is an extremely popular component library tool for building web applications.

`bun create <component>` scans for any shadcn/ui components imported from `@/components/ui`.

If it finds any, it runs:

```bash
# Assuming bun detected imports to @/components/ui/accordion and @/components/ui/button
$ bunx shadcn@canary add accordion button # and any other components
```

Since `shadcn/ui` itself uses TailwindCSS, `bun create` also adds the necessary TailwindCSS dependencies to your `package.json` and configures `bunfig.toml` to use Bun's TailwindCSS plugin with `Bun.serve()` as described above.

Additionally, we setup the following:

- `tsconfig.json` to alias `"@/*"` to `"src/*"` or `.` (depending on if there is a `src/` directory)
- `components.json` so that shadcn/ui knows its a shadcn/ui project
- `styles/globals.css` file that configures Tailwind v4 in the way that shadcn/ui expects
- `${component}.build.ts` file that builds the component for production with `bun-plugin-tailwind` configured

`bun create ./MyComponent.jsx` is one of the easiest ways to run code generated from LLMs like [Claude](https://claude.ai) or ChatGPT locally.

## From `npm`

```sh
$ bun create <template> [<destination>]
```

Assuming you don't have a [local template](#from-a-local-template) with the same name, this command will download and execute the `create-<template>` package from npm. The following two commands will behave identically:

```sh
$ bun create remix
$ bunx create-remix
```

Refer to the documentation of the associated `create-<template>` package for complete documentation and usage instructions.

## From GitHub

This will download the contents of the GitHub repo to disk.

```bash
$ bun create <user>/<repo>
$ bun create github.com/<user>/<repo>
```

Optionally specify a name for the destination folder. If no destination is specified, the repo name will be used.

```bash
$ bun create <user>/<repo> mydir
$ bun create github.com/<user>/<repo> mydir
```

Bun will perform the following steps:

- Download the template
- Copy all template files into the destination folder
- Install dependencies with `bun install`.
- Initialize a fresh Git repo. Opt out with the `--no-git` flag.
- Run the template's configured `start` script, if defined.

{% callout %}
By default Bun will _not overwrite_ any existing files. Use the `--force` flag to overwrite existing files.
{% /callout %}

<!-- ### Official templates

The following official templates are available.

```bash
bun create next ./myapp
bun create react ./myapp
bun create svelte-kit ./myapp
bun create elysia ./myapp
bun create hono ./myapp
bun create kingworld ./myapp
```

Each of these corresponds to a directory in the [bun-community/create-templates](https://github.com/bun-community/create-templates) repo. If you think a major framework is missing, please open a PR there. This list will change over time as additional examples are added. To see an up-to-date list, run `bun create` with no arguments.

```bash
$ bun create
Welcome to bun! Create a new project by pasting any of the following:
  <list of templates>
```

{% callout %}
⚡️ **Speed** — At the time of writing, `bun create react app` runs ~11x faster on a M1 Macbook Pro than `yarn create react-app app`.
{% /callout %} -->

<!-- ### GitHub repos

A template of the form `<username>/<repo>` will be downloaded from GitHub.

```bash
$ bun create ahfarmer/calculator ./myapp
```

Complete GitHub URLs will also work:

```bash
$ bun create github.com/ahfarmer/calculator ./myapp
$ bun create https://github.com/ahfarmer/calculator ./myapp
```

Bun installs the files as they currently exist current default branch (usually `main` or `master`). Unlike `git clone` it doesn't download the commit history or configure a remote. -->

## From a local template

{% callout %}
**⚠️ Warning** — Unlike remote templates, running `bun create` with a local template will delete the entire destination folder if it already exists! Be careful.
{% /callout %}
Bun's templater can be extended to support custom templates defined on your local file system. These templates should live in one of the following directories:

- `$HOME/.bun-create/<name>`: global templates
- `<project root>/.bun-create/<name>`: project-specific templates

{% callout %}
**Note** — You can customize the global template path by setting the `BUN_CREATE_DIR` environment variable.
{% /callout %}

To create a local template, navigate to `$HOME/.bun-create` and create a new directory with the desired name of your template.

```bash
$ cd $HOME/.bun-create
$ mkdir foo
$ cd foo
```

Then, create a `package.json` file in that directory with the following contents:

```json
{
  "name": "foo"
}
```

You can run `bun create foo` elsewhere on your file system to verify that Bun is correctly finding your local template.

#### Setup logic

You can specify pre- and post-install setup scripts in the `"bun-create"` section of your local template's `package.json`.

```json
{
  "name": "@bun-examples/simplereact",
  "version": "0.0.1",
  "main": "index.js",
  "dependencies": {
    "react": "^17.0.2",
    "react-dom": "^17.0.2"
  },
  "bun-create": {
    "preinstall": "echo 'Installing...'", // a single command
    "postinstall": ["echo 'Done!'"], // an array of commands
    "start": "bun run echo 'Hello world!'"
  }
}
```

The following fields are supported. Each of these can correspond to a string or array of strings. An array of commands will be executed in order.

{% table %}

---

- `postinstall`
- runs after installing dependencies

---

- `preinstall`
- runs before installing dependencies

{% /table %}

After cloning a template, `bun create` will automatically remove the `"bun-create"` section from `package.json` before writing it to the destination folder.

## Reference

### CLI flags

{% table %}

- Flag
- Description

---

- `--force`
- Overwrite existing files

---

- `--no-install`
- Skip installing `node_modules` & tasks

---

- `--no-git`
- Don’t initialize a git repository

---

- `--open`
- Start & open in-browser after finish

{% /table %}

### Environment variables

{% table %}

- Name
- Description

---

- `GITHUB_API_DOMAIN`
- If you’re using a GitHub enterprise or a proxy, you can customize the GitHub domain Bun pings for downloads

---

- `GITHUB_TOKEN` (or `GITHUB_ACCESS_TOKEN`)
- This lets `bun create` work with private repositories or if you get rate-limited. `GITHUB_TOKEN` is chosen over `GITHUB_ACCESS_TOKEN` if both exist.

{% /table %}

{% details summary="How `bun create` works" %}

When you run `bun create ${template} ${destination}`, here’s what happens:

IF remote template

1. GET `registry.npmjs.org/@bun-examples/${template}/latest` and parse it
2. GET `registry.npmjs.org/@bun-examples/${template}/-/${template}-${latestVersion}.tgz`
3. Decompress & extract `${template}-${latestVersion}.tgz` into `${destination}`
   - If there are files that would overwrite, warn and exit unless `--force` is passed

IF GitHub repo

1. Download the tarball from GitHub’s API
2. Decompress & extract into `${destination}`
   - If there are files that would overwrite, warn and exit unless `--force` is passed

ELSE IF local template

1. Open local template folder
2. Delete destination directory recursively
3. Copy files recursively using the fastest system calls available (on macOS `fcopyfile` and Linux, `copy_file_range`). Do not copy or traverse into `node_modules` folder if exists (this alone makes it faster than `cp`)

4. Parse the `package.json` (again!), update `name` to be `${basename(destination)}`, remove the `bun-create` section from the `package.json` and save the updated `package.json` to disk.
   - IF Next.js is detected, add `bun-framework-next` to the list of dependencies
   - IF Create React App is detected, add the entry point in /src/index.{js,jsx,ts,tsx} to `public/index.html`
   - IF Relay is detected, add `bun-macro-relay` so that Relay works
5. Auto-detect the npm client, preferring `pnpm`, `yarn` (v1), and lastly `npm`
6. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
7. Run `${npmClient} install` unless `--no-install` is passed OR no dependencies are in package.json
8. Run any tasks defined in `"bun-create": { "postinstall" }` with the npm client
9. Run `git init; git add -A .; git commit -am "Initial Commit";`
   - Rename `gitignore` to `.gitignore`. NPM automatically removes `.gitignore` files from appearing in packages.
   - If there are dependencies, this runs in a separate thread concurrently while node_modules are being installed
   - Using libgit2 if available was tested and performed 3x slower in microbenchmarks

{% /details %}
