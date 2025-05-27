## bun tests

**IMPORTANT**: use the `bun bd` command instead of the `bun` command. For example:

✅ Good

```sh
bun bd test internal/ban-words.test.ts
bun bd ./foo.ts
```

The `bun bd` command runs the DEBUG build. If you forget to run the debug build, your changes will not be reflected..

### Run a file

To run a file, you can use the `bun bd <file-path>` command.

```sh
bun bd ./foo.ts
```

### Run tests

To run a single test, you need to use the `bun bd test <test-name>` command.

```sh
bun bd test internal/ban-words.test.ts
```

You must ALWAYS make sure to pass a file path to the `bun bd test <file-path>` command. DO NOT try to run ALL the tests at once unless you're in a specific subdirectory.

### Run a Node.js test

```sh
bun bd --silent node:test test-fs-link
```
