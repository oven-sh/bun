The `bun pm` command group provides a set of utilities for working with Bun's package manager.

To print the path to the `bin` directory for the local project:

```bash
$ bun pm bin
/path/to/current/project/node_modules/.bin
```

To get the path to the global `bin` directory:

```bash
$ bun pm bin
<$HOME>/.bun/bin
```

To print a list of packages installed in the current project and their resolved versions, excluding their dependencies. Use the `--all` flag to print the entire tree, including all nth-order dependencies.

```bash
$ bun pm ls
/path/to/project node_modules (5)
├── eslint@8.33.0
├── react@18.2.0
├── react-dom@18.2.0
├── typescript@4.8.4
└── zod@3.20.1
```

To print the path to Bun's global module cache:

```bash
$ bun pm cache
```

To clear Bun's global module cache:

```bash
$ bun pm cache rm
```
