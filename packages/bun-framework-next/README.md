# bun-framework-next

This package lets you use Next.js 12.2 with bun. This readme assumes you already installed bun.

To start a new project:

```bash
bun create next --open
```

To use Next.js 12 with an existing project:

```bash
bun add bun-framework-next
echo "framework = 'next'" > bunfig.toml
bun bun
```

Launch the development server:

```bash
bun dev
```

Open http://localhost:3000 with your browser to see the result.
