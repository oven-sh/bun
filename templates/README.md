# Templates for `bun create`

This repo contains the templates for `bun create`.

## Usage

> Refer to the [Bun docs](https://bun.dev/docs/templates) for complete documentation of `bun create`.

To see a list of all official templates:

```bash
$ bun create
```

To scaffold a new project using a particular template:

```bash
$ bun create <template> <dir>
```

To scaffold a new project using a GitHub repo as a template:

```bash
$ bun create user/repo <dir>
```

## Creating a template

Fork this repo and add your template to the `templates` directory. The name of the directory will be the template name. For example, if you add a template named `my-template`, you can scaffold a new project using it with:

```bash
$ bun create my-template <dir>
```

In the `package.json`, set the `"name"` field to the pattern `@bun-examples/<name>`. The template code will be auto-published to `npm` using this name, where it will later be downloaded by `bun create`.

```json
{
  "name": "@bun-examples/my-template"
}
```

The `package.json` can also contain some initialization logic in the `"bun-create"` field. This defines a set of hooks that `bun create` will run immediately after scaffolding a new project.

```json
{
  // other fields
  "bun-create": {
    "preinstall": "echo 'Installing...'",
    "postinstall": ["bun install"], // accepts array of commands,
    "start": "bun run server.ts"
  }
}
```

The `"start"` field is not executed, but it will be printed when a user scaffolds a new project using your template.

```bash
$ bun create my-template <dir>
# ...
Created my-template project successfully
# To get started, run:

  cd <dir>
  bun run server.ts # <- copied from the "start" field
```
