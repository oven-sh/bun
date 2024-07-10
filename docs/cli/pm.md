The `bun pm` command group provides a set of utilities for working with Bun's package manager.

To print the path to the `bin` directory for the local project:

```bash
$ bun pm bin
/path/to/current/project/node_modules/.bin
```

To print the path to the global `bin` directory:

```bash
$ bun pm bin -g
<$HOME>/.bun/bin
```

To print a list of installed dependencies in the current project and their resolved versions, excluding their dependencies.

```bash
$ bun pm ls
/path/to/project node_modules (135)
├── eslint@8.38.0
├── react@18.2.0
├── react-dom@18.2.0
├── typescript@5.0.4
└── zod@3.21.4
```

To print all installed dependencies, including nth-order dependencies.

```bash
$ bun pm ls --all
/path/to/project node_modules (135)
├── @eslint-community/eslint-utils@4.4.0
├── @eslint-community/regexpp@4.5.0
├── @eslint/eslintrc@2.0.2
├── @eslint/js@8.38.0
├── @nodelib/fs.scandir@2.1.5
├── @nodelib/fs.stat@2.0.5
├── @nodelib/fs.walk@1.2.8
├── acorn@8.8.2
├── acorn-jsx@5.3.2
├── ajv@6.12.6
├── ansi-regex@5.0.1
├── ...
```

To print the path to Bun's global module cache:

```bash
$ bun pm cache
```

To clear Bun's global module cache:

```bash
$ bun pm cache rm
```

## List global installs

To list all globally installed packages:

```bash
$ bun pm ls -g
```

To list all globally installed packages, including nth-order dependencies:

```bash
$ bun pm ls -g --all
```
