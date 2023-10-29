---
name: Add a trusted dependency
---

Unlike other npm clients, Bun does not execute arbitrary lifecycle scripts for installed dependencies, such as `postinstall` and `node-gyp` builds. These scripts represent a potential security risk, as they can execute arbitrary code on your machine.

{% callout %}
Soon, Bun will include a built-in allow-list that automatically allows lifecycle scripts to be run by popular packages that are known to be safe. This is still under development.
{% /callout %}

---

If you are seeing one of the following errors, you are probably trying to use a package that uses `postinstall` to work properly:

- `error: could not determine executable to run for package`
- `InvalidExe`

---

To tell Bun to allow lifecycle scripts for a particular package, add the package to `trustedDependencies` in your package.json.

Note that this only allows lifecycle scripts for the specific package listed in `trustedDependencies`, _not_ the dependencies of that dependency!

<!-- Bun maintains an allow-list of popular packages containing `postinstall` scripts that are known to be safe. To run lifecycle scripts for packages that aren't on this list, add the package to `trustedDependencies` in your package.json. -->

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
$ rm bun.lockb
$ bun install
```

---

Note that this only allows lifecycle scripts for the specific package listed in `trustedDependencies`, _not_ the dependencies of that dependency!

---

See [Docs > Package manager > Trusted dependencies](/docs/install/lifecycle) for complete documentation of trusted dependencies.
