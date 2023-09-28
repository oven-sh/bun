---
name: Using bun install with an Azure Artifacts npm registry
---

{% callout %}
In [Azure Artifact's](https://learn.microsoft.com/en-us/azure/devops/artifacts/npm/npmrc?view=azure-devops&tabs=windows%2Cclassic) instructions for `.npmrc`, they say to base64 encode the password. Do not do this for `bun install`. Bun will automatically base64 encode the password for you if needed.
{% /callout %}

[Azure Artifacts](https://azure.microsoft.com/en-us/products/devops/artifacts) is a package management system for Azure DevOps. It allows you to host your own private npm registry, npm packages, and other types of packages as well.

---

### Configure with bunfig.toml

---

To use it with `bun install`, add a `bunfig.toml` file to your project with the following contents. Make sure to replace `my-azure-artifacts-user` with your Azure Artifacts username, such as `jarred1234`.

```toml#bunfig.toml
[install.registry]
url = "https://pkgs.dev.azure.com/my-azure-artifacts-user/_packaging/my-azure-artifacts-user/npm/registry"
username = "my-azure-artifacts-user"
# Bun v1.0.3+ supports using an environment variable here
password = "$NPM_PASSWORD"
```

---

Then assign your Azure Personal Access Token to the the `NPM_PASSWORD` environment variable. Bun [automatically reads](/docs/runtime/env) `.env` files, so create a file called `.env` in your project root. There is no need to base-64 encode this token! Bun will do this for you.

```txt#.env
NPM_PASSWORD=<paste token here>
```

---

### Configure with environment variables

---

To configure Azure Artifacts without `bunfig.toml`, you can set the `NPM_CONFIG_REGISTRY` environment variable. The URL should include `:username` and `:_password` as query parameters. Replace `<USERNAME>` and `<PASSWORD>` with the apprropriate values.

```bash#shell
NPM_CONFIG_REGISTRY=https://pkgs.dev.azure.com/my-azure-artifacts-user/_packaging/my-azure-artifacts-user/npm/registry/:username=<USERNAME>:_password=<PASSWORD>
```

---

### Don't base64 encode the password

---

In [Azure Artifact's](https://learn.microsoft.com/en-us/azure/devops/artifacts/npm/npmrc?view=azure-devops&tabs=windows%2Cclassic) instructions for `.npmrc`, they say to base64 encode the password. Do not do this for `bun install`. Bun will automatically base64 encode the password for you if needed.

{% callout %}
**Tip** — If it ends with `==`, it probably is base64 encoded.
{% /callout %}

---

To decode a base64-encoded password, open your browser console and run:

```js
atob("<base64-encoded password>");
```

---

Alternatively, use the `base64` command line tool, but doing so means it may be saved in your terminal history which is not recommended:

```bash
echo "base64-encoded-password" | base64 --decode
```
