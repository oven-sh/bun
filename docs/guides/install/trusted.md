---
name: Add a trusted dependency
---

Unlike other npm clients, Bun does not execute arbitrary lifecycle scripts for installed dependencies, such as `postinstall` and `node-gyp` builds. These scripts represent a potential security risk, as they can execute arbitrary code on your machine.

{% callout %}
Bun includes a default allowlist of popular packages containing `postinstall` scripts that are known to be safe. You can see this list [here](https://github.com/oven-sh/bun/blob/main/src/install/default-trusted-dependencies.txt).
{% /callout %}

---

If you are seeing one of the following errors, you are probably trying to use a package that uses `postinstall` to work properly:

- `error: could not determine executable to run for package`
- `InvalidExe`

---

To allow Bun to execute lifecycle scripts for a specific package, add the package to `trustedDependencies` in your package.json file. You can do this automatically by running the command `bun pm trust <pkg>`.

{% callout %}
Note that this only allows lifecycle scripts for the specific package listed in `trustedDependencies`, _not_ the dependencies of that dependency!
{% /callout %}

```json-diff
  {
    "name": "my-app",
    "version": "1.0.0",
+   "trustedDependencies": ["my-trusted-package"]
  }
```

---

Once this is added, run a fresh install. Bun will re-install your dependencies and properly install

```sh
$ rm -rf node_modules
$ rm bun.lock
$ bun install
```

---

See [Docs > Package manager > Trusted dependencies](https://bun.com/docs/install/lifecycle) for complete documentation of trusted dependencies.
