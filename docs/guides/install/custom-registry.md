---
name: Override the default npm registry for bun install
---

The default registry is `registry.npmjs.org`. This can be globally configured in `bunfig.toml`.

```toml#bunfig.toml
[install]
# set default registry as a string
registry = "https://registry.npmjs.org"

# if needed, set a token
registry = { url = "https://registry.npmjs.org", token = "123456" }

# if needed, set a username/password
registry = "https://username:password@registry.npmjs.org"
```

---

Your `bunfig.toml` can reference environment variables. Bun automatically loads environment variables from `.env.local`, `.env.[NODE_ENV]`, and `.env`. See [Docs > Environment variables](https://bun.sh/docs/runtime/env) for more information.

```toml#bunfig.toml
[install]
registry = { url = "https://registry.npmjs.org", token = "$npm_token" }
```

---

See [Docs > Package manager](https://bun.sh/docs/cli/install) for complete documentation of Bun's package manager.
