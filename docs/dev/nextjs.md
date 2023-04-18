To create a new Next.js app with bun:

```bash
$ bun create nextjs ./app
$ cd app
$ bun dev # start dev server
```

To use an existing Next.js app with bun:

```bash
$ bun add bun-framework-next
$ echo "framework = 'next'" > bunfig.toml
$ bun bun # bundle dependencies
$ bun dev # start dev server
```

Many of Next.js’ features are supported, but not all.

Here’s what doesn’t work yet:

- `getStaticPaths`
- same-origin `fetch` inside of `getStaticProps` or `getServerSideProps`
- locales, zones, `assetPrefix` (workaround: change `--origin \"http://localhost:3000/assetPrefixInhere\"`)
- `next/image` is polyfilled to a regular `<img src>` tag.
- `proxy` and anything else in `next.config.js`
- API routes, middleware (middleware is easier to support, though! Similar SSR API)
- styled-jsx (technically not Next.js, but often used with it)
- React Server Components

When using Next.js, Bun automatically reads configuration from `.env.local`, `.env.development` and `.env` (in that order). `process.env.NEXT_PUBLIC_` and `process.env.NEXT_` automatically are replaced via `--define`.

Currently, any time you import new dependencies from `node_modules`, you will need to re-run `bun bun --use next`. This will eventually be automatic.
