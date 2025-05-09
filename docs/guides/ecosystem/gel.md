---
name: Use Gel with Bun
---

Gel is a next-generation graph-relational database designed as a spiritual successor to the relational database.

It inherits the strengths of SQL databases: type safety, performance, reliability, and transactionality. But instead of modeling data in a relational (tabular) way, Gel represents data with object types containing properties and links to other objects. It leverages this object-oriented model to provide a superpowered query language that solves some of SQL's biggest usability problems.

---

First, [install Gel](https://www.geldata.com/) if you haven't already.

                                         /$$$$
                                        /$$$$$$
                                       | $$$$$$
         /$$$$$$$$        /$$$$$$$     | $$$$$$
       /$$$$$$$$$$$$    /$$$$$$$$$$$   | $$$$$$
      /$$$$$$$$$$$$$$  /$$$$$$$$$$$$$  | $$$$$$
                                         /$$$$
                                        /$$$$$$
                                       | $$$$$$
         /$$$$$$$$        /$$$$$$$     | $$$$$$
       /$$$$$$$$$$$$    /$$$$$$$$$$$   | $$$$$$
      /$$$$$$$$$$$$$$  /$$$$$$$$$$$$$  | $$$$$$
     | $$$$$$$$$$$$$$ | $$$$$$$$$$$$$  | $$$$$$
      \ $$$$$$$$$$$$   \ $$$$$$$/      | $$$$$$
       \_ $$$$$$$$_/    \_ $$$$$$$      \ $$$$/
         \_______/        \______/       \___/

Welcome to Gel! with Bun\_/

{% codetabs %}

```sh#Linux/macOS
$ curl https://www.geldata.com/sh --proto "=https" -sSf | sh
```

```sh#Windows
$ irm https://www.geldata.com/ps1 | iex
```

{% /codetabs %}

---

Use `bun init` to create a fresh project.

```sh
$ mkdir my-gel-db
$ cd my-gel-db
$ bun init -y
```

---

We'll use the Gel CLI to initialize an Gel DataBase instance for our project. This creates an `gel.toml` file in our project root.

```sh
$ bunx gel project init
No `gel.toml` found in `/home/username/bun-app/my-gel-db` or above
Do you want to initialize a new project? [Y/n]
> Y
Specify the name of Gel instance to use with this project [default: my_gel_db]:
> my_gel_db
Checking Gel versions...
Specify the version of Gel to use with this project [default: x.y]:
> x.y
Specify branch name: [default: main]:
> main
┌─────────────────────┬───────────────────────────────────────────────────────┐
│ Project directory   │ /home/username/bun-app/my-gel-db                      │
│ Project config      │ /home/username/bun-app/my-gel-db/gel.toml             │
│ Schema dir (empty)  │ /home/username/bun-app/my-gel-db/dbschema             │
│ Installation method │ portable package                                      │
│ Version             │ x.y+01d987d                                           │
│ Instance name       │ my_gel_db                                             │
│ Branch              │ main                                                  │
└─────────────────────┴───────────────────────────────────────────────────────┘
Version x.y+01d987d is already downloaded
Initializing Gel instance...
Applying migrations...
Everything is up to date. Revision initial
Project initialized.
To connect to my-gel-db, run `gel`
```

---

After all these manipulations, you should already have in your arsenal `gel` command, if not, then go back to [install Gel](https://www.geldata.com/)

```sh
$ gel
                     ▄██▄
   ▄▄▄▄▄      ▄▄▄    ████
 ▄███████▄ ▄███████▄ ████
 ▀███████▀ ▀███▀▀▀▀▀ ████
   ▀▀▀▀▀      ▀▀▀     ▀▀
  ▀▄▄▄▄▄▀
    ▀▀▀

Gel x.y+01d987d (repl x.y.0+70c7e2d)
Type \help for help, \quit to quit.
cube:main>
```

Now you have a dbschema to work with in the future. On the [Gel Docs](https://docs.geldata.com/) website you can study very convenient documentation written by the Gel authors.
