To create a new React app:

```bash
$ bun create react ./app
$ cd app
$ bun dev # start dev server
```

To use an existing React app:

```bash
$ bun add -d react-refresh # install React Fast Refresh
$ bun bun ./src/index.js # generate a bundle for your entry point(s)
$ bun dev # start the dev server
```

From there, Bun relies on the filesystem for mapping dev server paths to source files. All URL paths are relative to the project root (where `package.json` is located).

Here are examples of routing source code file paths:

| Dev Server URL             | File Path (relative to cwd) |
| -------------------------- | --------------------------- |
| /src/components/Button.tsx | src/components/Button.tsx   |
| /src/index.tsx             | src/index.tsx               |
| /pages/index.js            | pages/index.js              |

You do not need to include file extensions in `import` paths. CommonJS-style import paths without the file extension work.

You can override the public directory by passing `--public-dir="path-to-folder"`.

If no directory is specified and `./public/` doesn’t exist, Bun will try `./static/`. If `./static/` does not exist, but won’t serve from a public directory. If you pass `--public-dir=./` Bun will serve from the current directory, but it will check the current directory last instead of first.
