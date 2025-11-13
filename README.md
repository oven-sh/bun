<h1 align="center">Ion</h1>

## What is Ion?

Ion is a fork of Bun for Altare Technologies.

Ion is an all-in-one toolkit for JavaScript and TypeScript apps. It ships as a single executable called `ion`.

At its core is the _Ion runtime_, a fast JavaScript runtime designed as **a drop-in replacement for Node.js**. It's written in Zig and powered by JavaScriptCore under the hood, dramatically reducing startup times and memory usage.

```bash
ion run index.tsx             # TS and JSX supported out-of-the-box
```

The `ion` command-line tool also implements a test runner, script runner, and Node.js-compatible package manager. Instead of 1,000 node_modules for development, you only need `ion`. Ion's built-in tools are significantly faster than existing options and usable in existing Node.js projects with little to no changes.

```bash
ion test                      # run tests
ion run start                 # run the `start` script in `package.json`
ion install <pkg>             # install a package
ionx cowsay 'Hello, world!'   # execute a package
```

## Building Ion

See the development documentation below for information on building and contributing to Ion.

## Development

Ion is built on top of Bun. For development and build instructions, see the CLAUDE.md file.

## Contributing

For contributing to the upstream Bun project, see [https://bun.com/docs/project/contributing](https://bun.com/docs/project/contributing).

## License

Ion is a fork of Bun. For original Bun licensing information, see [https://bun.com/docs/project/licensing](https://bun.com/docs/project/licensing).

© 2025 Altare Technologies Limited. All rights reserved.
