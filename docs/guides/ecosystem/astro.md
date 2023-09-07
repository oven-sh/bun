---
name: Build an app with Astro and Bun
---

Initialize a fresh Astro app with `bunx create-astro`. The `create-astro` package detects when you are using `bunx` and will automatically install dependencies using `bun`.

```sh
$ bunx create-astro
╭─────╮  Houston:
│ ◠ ◡ ◠  We're glad to have you on board.
╰─────╯

 astro   v2.10.5 Launch sequence initiated.

   dir   Where should we create your new project?
         ./fumbling-field

  tmpl   How would you like to start your new project?
         Use blog template
      ✔  Template copied

  deps   Install dependencies?
         Yes
      ✔  Dependencies installed

    ts   Do you plan to write TypeScript?
         Yes

   use   How strict should TypeScript be?
         Strict
      ✔  TypeScript customized

   git   Initialize a new git repository?
         Yes
      ✔  Git initialized

  next   Liftoff confirmed. Explore your project!

         Enter your project directory using cd ./fumbling-field
         Run `bun run dev` to start the dev server. CTRL+C to stop.
         Add frameworks like react or tailwind using astro add.

         Stuck? Join us at https://astro.build/chat

╭─────╮  Houston:
│ ◠ ◡ ◠  Good luck out there, astronaut! 🚀
╰─────╯
```

---

Start the dev server with `bunx`.

By default, Bun will run the dev server with Node.js. To use the Bun runtime instead, use the `--bun` flag.

```sh
$ bunx --bun astro dev
  🚀  astro  v2.10.5 started in 200ms

  ┃ Local    http://localhost:3000/
  ┃ Network  use --host to expose

01:48:34 PM [content] Watching src/content/ for changes
01:48:34 PM [content] Types generated
01:48:34 PM [astro] update /.astro/types.d.ts
```

---

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result. Astro will hot-reload your app as you edit your source files.

{% image src="https://github.com/vitejs/vite/assets/3084745/bb1d5063-32f4-4598-b33e-50b44a1c4e8a" caption="An Astro starter app running on Bun" %}

---

Refer to the [Astro docs](https://docs.astro.build/en/getting-started/) for complete documentation.
