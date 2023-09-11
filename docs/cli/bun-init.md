`bun init` is a quick way to start a blank project with Bun. It guesses with sane defaults and is non-destructive when run multiple times.

![Demo](https://user-images.githubusercontent.com/709451/183006613-271960a3-ff22-4f7c-83f5-5e18f684c836.gif)

It creates:

- a `package.json` file with a name that defaults to the current directory name
- a `tsconfig.json` file or a `jsconfig.json` file, depending if the entry point is a TypeScript file or not
- an entry point which defaults to `index.ts` unless any of `index.{tsx, jsx, js, mts, mjs}` exist or the `package.json` specifies a `module` or `main` field
- a `README.md` file

If you pass `-y` or `--yes`, it will assume you want to continue without asking questions.

At the end, it runs `bun install` to install `bun-types`.

#### How is `bun init` different than `bun create`?

`bun init` is for blank projects. `bun create` applies templates.
