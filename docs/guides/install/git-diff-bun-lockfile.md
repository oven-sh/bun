---
name: Configure git to diff Bun's lockb lockfile
---

To teach `git` how to generate a human-readable diff of Bun's binary lockfile format (`.lockb`), add the following to your local or global `.gitattributes` file:

```js
*.lockb binary diff=lockb
```

---

Then add the following to you local git config with:

```sh
$ git config diff.lockb.textconv bun
$ git config diff.lockb.binary true
```

---

To globally configure git to diff Bun's lockfile, add the following to your global git config with:

```sh
$ git config --global diff.lockb.textconv bun
$ git config --global diff.lockb.binary true
```

---

## How this works

Why this works:

- `textconv` tells git to run bun on the file before diffing
- `binary` tells git to treat the file as binary (so it doesn't try to diff it line-by-line)

In Bun, you can execute Bun's lockfile (`bun ./bun.lockb`) to generate a human-readable version of the lockfile and `git diff` can then use that to generate a human-readable diff.
