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

---

Initialize a Reejs app with `create-reejs`.

Choose any features you want. Incompatible features will be mentioned before-hand.

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
│  ./my-reejs-app
│
◇  Choose the features you want to include in your project
│  React, Twind CSS, API Server, Serve Static Files
│
◇  Which package manager do you want to use (alongside URL Imports)?
│  bun
│
◇  Should we install dependencies for you?
│  Yes
│
◇   ────────────────────────────────────────────────╮
│                                                   │
│  cd into ./my-reejs-app and run `reejs install`  │
│                                                   │
├───────────────────────────────────────────────────╯
│
└  Let's get started!

```

---

Check for the existence of the `.reejs` to verify that the dependencies are installed.

If not, run `reejs i` to install and link dependencies.

```sh
$ ls .reejs
cache       copy.cache  deps        files.cache serve       serve.cache
```

---

Then start the dev server.

Note that `-d` runs Packit (the underlying code generator & transpiler) in dev mode, which watches for file changes and disables minification.

```sh
$ reejs packit bun -d
```

---

Open [http://localhost:3000](http://localhost:3000) to see the app.

---

To build and run a production app with Reejs, don't use the `-d` flag. This will generate a `*.build.js` file that can be executed directly with `bun`.

```sh
$ reejs packit bun
$ bun ./packit.build.js
```

---

Read the [Reejs docs](https://ree.js.org/) for more information on how to build apps with Reejs.

```

```
