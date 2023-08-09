---
name: Build a fullstack app with Nest.js and Bun
---

{% callout %}
Requires Bun `v0.7.0` or later.
{% /callout %}

---

Initialize your app with the Nest.js CLI.

```sh
$ bunx @nestjs/cli new my-app
⚡  We will scaffold your app in a few seconds..

? Which package manager would you ❤️  to use? bun
CREATE my-app/.eslintrc.js (663 bytes)
CREATE my-app/.prettierrc (51 bytes)
CREATE my-app/README.md (3347 bytes)
CREATE my-app/nest-cli.json (171 bytes)
CREATE my-app/package.json (1947 bytes)
CREATE my-app/tsconfig.build.json (97 bytes)
CREATE my-app/tsconfig.json (546 bytes)
CREATE my-app/src/app.controller.spec.ts (617 bytes)
CREATE my-app/src/app.controller.ts (274 bytes)
CREATE my-app/src/app.module.ts (249 bytes)
CREATE my-app/src/app.service.ts (142 bytes)
CREATE my-app/src/main.ts (208 bytes)
CREATE my-app/test/app.e2e-spec.ts (630 bytes)
CREATE my-app/test/jest-e2e.json (183 bytes)

✔ Installation in progress... ☕

🚀  Successfully created project my-app
👉  Get started with the following commands:

$ cd my-app
$ bun run start
```

---

As the Nest.js templater intructed, let's `cd` into our app directory and start the development server.

```sh
$ cd my-app
$ bun run start
```

---

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result. Any changes you make to `pages/index.tsx` will be hot-reloaded in the browser.
