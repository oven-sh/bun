---
name: Add a trusted dependency
---

Unlike other npm clients, Bun does not execute arbitrary lifecycle scripts for installed dependencies, such as `postinstall` and `node-gyp` builds. These scripts represent a potential security risk, as they can execute arbitrary code on your machine.

---

To tell Bun to allow lifecycle scripts for a particular package, add the package to `trustedDependencies` in your package.json.

```json-diff
  {
    "name": "my-app",
    "version": "1.0.0",
+   "trustedDependencies": ["my-trusted-package"]
  }
```

<!-- Bun maintains an allow-list of popular packages containing `postinstall` scripts that are known to be safe. To run lifecycle scripts for packages that aren't on this list, add the package to `trustedDependencies` in your package.json. -->

---

Note that this only allows lifecycle scripts for the specific package listed in `trustedDependencies`, _not_ the dependencies of that dependency!

Soon, Bun will include a built-in allow-list that automatically allows lifecycle scripts to be run by popular packages that are known to be safe. This is still under development.

---

See [Docs > Package manager > Trusted dependencies](/docs/cli/install#trusted-dependencies) for complete documentation of trusted dependencies.
