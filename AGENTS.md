## bun tests

**IMPORTANT**: use the `bun agent` command instead of the `bun` command. For example:

✅ Good

```sh
bun agent test internal/ban-words.test.ts
bun agent ./foo.ts
```

The `bun agent` command runs the DEBUG build. If you forget to run the debug build, your changes will not be reflected..

### Run a file

To run a file, you can use the `bun agent <file-path>` command.

```sh
bun agent ./foo.ts
```

### Run tests

To run a single test, you need to use the `bun agent test <test-name>` command.

```sh
bun agent test internal/ban-words.test.ts
```

You must ALWAYS make sure to pass a file path to the `bun agent test <file-path>` command. DO NOT try to run ALL the tests at once unless you're in a specific subdirectory.

### Run a Node.js test

```sh
bun agent --silent node:test test-fs-link
```
