Scaffold an empty Bun project with the interactive `bun init` command.

```bash
$ bun init
bun init helps you get started with a minimal project and tries to
guess sensible defaults. Press ^C anytime to quit.

package name (quickstart):
entry point (index.ts):

Done! A package.json file was saved in the current directory.
 + index.ts
 + .gitignore
 + tsconfig.json (for editor auto-complete)
 + README.md

To get started, run:
  bun run index.ts
```

Press `enter` to accept the default answer for each prompt, or pass the `-y` flag to auto-accept the defaults.

{% details summary="How `bun init` works" %}

`bun init` is a quick way to start a blank project with Bun. It guesses with sane defaults and is non-destructive when run multiple times.

![Demo](https://user-images.githubusercontent.com/709451/183006613-271960a3-ff22-4f7c-83f5-5e18f684c836.gif)

It creates:

- a `package.json` file with a name that defaults to the current directory name
- a `tsconfig.json` file or a `jsconfig.json` file, depending if the entry point is a TypeScript file or not
- an entry point which defaults to `index.ts` unless any of `index.{tsx, jsx, js, mts, mjs}` exist or the `package.json` specifies a `module` or `main` field
- a `README.md` file

AI Agent rules (disable with `$BUN_AGENT_RULE_DISABLED=1`):

- a `CLAUDE.md` file when Claude CLI is detected (disable with `CLAUDE_CODE_AGENT_RULE_DISABLED` env var)
- a `.cursor/rules/*.mdc` file to guide [Cursor AI](https://cursor.sh) to use Bun instead of Node.js and npm when Cursor is detected

If you pass `-y` or `--yes`, it will assume you want to continue without asking questions.

At the end, it runs `bun install` to install `@types/bun`.

{% /details %}

{% bunCLIUsage command="init" /%}

## React

The `--react` flag will scaffold a React project:

```bash
$ bun init --react
```

The `--react` flag accepts the following values:

- `tailwind` - Scaffold a React project with Tailwind CSS
- `shadcn` - Scaffold a React project with Shadcn/UI and Tailwind CSS

### React + TailwindCSS

This will create a React project with Tailwind CSS configured with Bun's bundler and dev server.

```bash
$ bun init --react=tailwind
```

### React + @shadcn/ui

This will create a React project with shadcn/ui and Tailwind CSS configured with Bun's bundler and dev server.

```bash
$ bun init --react=shadcn
```
