---
name: Using bun install with an Azure Artifacts npm registry
---

[Azure Artifacts](https://azure.microsoft.com/en-us/products/devops/artifacts) is a package management system for Azure DevOps. It allows you to host your own private npm registry, npm packages, and other types of packages as well.

To use it with `bun install`, add a `bunfig.toml` file to your project with the following contents:

### Configure with bunfig.toml

```toml#bunfig.toml
[install.registry]
url = "https://pkgs.dev.azure.com/my-azure-artifacts-user/_packaging/my-azure-artifacts-user/npm/registry"
username = "my-azure-artifacts-user"
password = "$NPM_PASSWORD"
```

Make sure to replace `my-azure-artifacts-user` with your Azure Artifacts username, such as `jarred1234`.

The `$NPM_PASSWORD` should be replaced with your Azure Artifacts npm registry password.

Note: **password must not be base64 encoded**. In [Azure Artifact's](https://learn.microsoft.com/en-us/azure/devops/artifacts/npm/npmrc?view=azure-devops&tabs=windows%2Cclassic) instructions for `.npmrc`, they say to base64 encode the password. Do not do this for `bun install`. Bun will automatically base64 encode the password for you if needed.

To un-base64 encode a password, you can open your browser console and run:

```js
atob("base64-encoded-password");
```

If it ends with `==`, it probably is base64 encoded.

### Configure with environment variables

You can also use an environment variable to configure Azure Artifacts with bun install.

Like with the `npm` CLI, the environment variable to use is `NPM_CONFIG_REGISTRY`.

The URL should include `:username` and `:_password` as query parameters. For example:

```bash
NPM_CONFIG_REGISTRY=https://pkgs.dev.azure.com/my-azure-artifacts-user/_packaging/my-azure-artifacts-user/npm/registry/:username=my-azure-artifacts-user:_password=my-azure-artifacts-password
```

Make sure to:

- Replace `my-azure-artifacts-user` with your Azure Artifacts username, such as `jarred1234`
- Replace `my-azure-artifacts-password` with the non-base64 encoded password for your Azure Artifacts npm registry. If it ends with `==`, it probably is base64 encoded.

To un-base64 encode a password, you can open your browser console and run:

```js
atob("base64-encoded-password");
```
