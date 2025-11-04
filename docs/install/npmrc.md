Bun supports loading configuration options from [`.npmrc`](https://docs.npmjs.com/cli/v10/configuring-npm/npmrc) files, allowing you to reuse existing registry/scope configurations.

{% callout %}

**NOTE**: We recommend migrating your `.npmrc` file to Bun's [`bunfig.toml`](https://bun.com/docs/runtime/bunfig) format, as it provides more flexible options and can let you configure Bun-specific options.

{% /callout %}

## Supported options

### `registry`: Set the default registry

The default registry is used to resolve packages, its default value is `npm`'s official registry (`https://registry.npmjs.org/`).

To change it, you can set the `registry` option in `.npmrc`:

```ini
registry=http://localhost:4873/
```

The equivalent `bunfig.toml` option is [`install.registry`](https://bun.com/docs/runtime/bunfig#install-registry):

```toml
install.registry = "http://localhost:4873/"
```

### `@<scope>:registry`: Set the registry for a specific scope

Allows you to set the registry for a specific scope:

```ini
@myorg:registry=http://localhost:4873/
```

The equivalent `bunfig.toml` option is to add a key in [`install.scopes`](https://bun.com/docs/runtime/bunfig#install-registry):

```toml
[install.scopes]
myorg = "http://localhost:4873/"
```

### `//<registry_url>/:<key>=<value>`: Configure options for a specific registry

Allows you to set options for a specific registry:

```ini
# set an auth token for the registry
# ${...} is a placeholder for environment variables
//http://localhost:4873/:_authToken=${NPM_TOKEN}


# or you could set a username and password
# note that the password is base64 encoded
//http://localhost:4873/:username=myusername

//http://localhost:4873/:_password=${NPM_PASSWORD}

# or use _auth, which is your username and password
# combined into a single string, which is then base 64 encoded
//http://localhost:4873/:_auth=${NPM_AUTH}
```

The following options are supported:

- `_authToken`
- `username`
- `_password` (base64 encoded password)
- `_auth` (base64 encoded username:password, e.g. `btoa(username + ":" + password)`)

The equivalent `bunfig.toml` option is to add a key in [`install.scopes`](https://bun.com/docs/runtime/bunfig#install-registry):

```toml
[install.scopes]
myorg = { url = "http://localhost:4873/", username = "myusername", password = "$NPM_PASSWORD" }
```

### `link-workspace-packages`: Control workspace package installation

Controls how workspace packages are installed when available locally:

```ini
link-workspace-packages=true
```

The equivalent `bunfig.toml` option is [`install.linkWorkspacePackages`](https://bun.com/docs/runtime/bunfig#install-linkworkspacepackages):

```toml
[install]
linkWorkspacePackages = true
```

### `save-exact`: Save exact versions

Always saves exact versions without the `^` prefix:

```ini
save-exact=true
```

The equivalent `bunfig.toml` option is [`install.exact`](https://bun.com/docs/runtime/bunfig#install-exact):

```toml
[install]
exact = true
```
