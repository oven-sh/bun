---
name: Build an app with Next.js and Bun
---

{% callout %}
The Next.js [App Router](https://nextjs.org/docs/app) currently relies on Node.js APIs that Bun does not yet implement. The guide below uses Bun to initialize a project and install dependencies, but it uses Node.js to run the dev server.
{% /callout %}

---

Initialize a Next.js app with `create-next-app`. This automatically installs dependencies using `npm`.

```sh
$ bun create next-app
✔ What is your project named? … my-app
✔ Would you like to use TypeScript with this project? … No / Yes
✔ Would you like to use ESLint with this project? … No / Yes
✔ Would you like to use `src/` directory with this project? … No / Yes
✔ Would you like to use experimental `app/` directory with this project? … No / Yes
✔ What import alias would you like configured? … @/*
Creating a new Next.js app in /path/to/my-app.
```

---

To start the dev server with Bun, run `bun --bun run dev` from the project root.

```sh
$ cd my-app
$ bun --bun run dev
```

---

To run the dev server with Node.js instead, omit `--bun`.

```sh
$ cd my-app
$ bun run dev
```

---

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result. Any changes you make to `(pages/app)/index.tsx` will be hot-reloaded in the browser.
