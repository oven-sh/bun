---
name: Build an app with Reejs and Bun
---

{% callout %}
Currently Reejs depends on `node:repl` to provide a custom repl service for `reejs repl` command. Therefore `repl` command is disabled for Bun (and Deno). Other things should work fine as expected.
{% /callout %}

---

Install Reejs globally, as this improves your developer experience.

```sh
$ bun i reejs -g
```

Initialize a Reejs app with `create-reejs`.

```sh
$ reejs x https://esm.sh/create-reejs
✓ https://esm.sh/create-reejs@0.14.0 in 0.12s

╭────────────────────────────────╮
│                                │
│   Welcome to Reejs Framework   │
│                                │
╰────────────────────────────────╯

┌  Let's create a new project!
│
◇  What would we create your next project?
│  ./reejs-project
│
◇  Choose the features you want to include in your project
│  React, Twind CSS, API Server, Serve Static Files
│
◇  Which package manager do you want to use (alongside URL Imports)?
│  bun
│
◇  Should we install dependencies for you?
│  No
│
◇   ────────────────────────────────────────────────╮
│                                                   │
│  cd into ./reejs-project and run `reejs install`  │
│                                                   │
├───────────────────────────────────────────────────╯
│
└  Let's get started!

```

> Note: Feel free to choose any features you want. Incompatible features will be mentioned before-hand.

Verify that the dependencies are installed. You can do that by looking whether `.reejs` folder is filled with lot of files inside `.reejs/cache` folder and `node_modules` folder seems to be filled too. If not, run `reejs i` to install the dependencies and link them.

To run the dev server, run `reejs packit bun -d`. Please note that `-d` runs Packit (the underlying code generator & transpiler) to run in dev mode - continuously looking for file changes and not minifying files. To run reejs in production, run `reejs packit bun`. It will generate a `packit.build.js` file, use `bun ./packit.build.js` to run it.

Open [http://localhost:3000](http://localhost:3000) to see the app.

Read the [Reejs docs](https://ree.js.org/) for more information on how to build apps with Reejs.

If Reejs ever fails on Bun (but runs on Nodejs), **please** consider making an issue on their [github](https://github.com/rovelstars/reejs/issues).