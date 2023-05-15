# React SSR

This is a project demonstrating how to build a simple Bun app with server-side rendering React + client-side hydration.

## Getting started

```sh
bun create react-ssr
bun install
bun run dev
```

This starts the development server in watch mode. Open http://localhost:3000 in your browser to see the result.

## Learn more

The following files are the most important:

- `dev.tsx`: Generates a browser build of all `pages` using `Bun.build`, then starts a dev server that handles incoming requests. For paths like `/` and `/settings`, the server will render the appropriate page in `pages` to static HTML and return the result. The returned HTML includes a `<script>` tag that imports a bundled version of `hydrate.tsx`.
- `hydrate.tsx`: A script that hydrates the static HTML returned by the server.
- `pages/*.tsx`: A set of pages. Incoming requests are resolved against this directory using Next.js-style routing.
