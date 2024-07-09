Bun supports loading configuration options from [`.npmrc`](https://docs.npmjs.com/cli/v10/configuring-npm/npmrc) files, allowing you to reuse existing registry/scope configurations.

{% callout %}

**NOTE**: We recommend migrating your `.npmrc` file to Bun's [`bunfig.toml`](/docs/runtime/bunfig) format, as it provides more flexible options and can let you configure Bun-specific configuration options.

{% /callout %}

# Supported options

### `registry`: Set the default registry

The default registry is used to resolve packages, it's default value is `npm`'s official registry (`https://registry.npmjs.org/`).

To change it, you can set the `registry` option in `.npmrc`:

```ini
registry=http://localhost:4873/
```

The equivalent `bunfig.toml` option is [`install.registry`](/docs/runtime/bunfig#install-registry):

```toml
install.registry = "http://localhost:4873/"
```

### `@<scope>:registry`: Set the registry for a specific scope

Allows you to set the registry for a specific scope:

```ini
@myorg:registry=http://localhost:4873/
```

The equivalent `bunfig.toml` option is to add a key in [`install.scopes`](/docs/runtime/bunfig#install-registry):

```toml
[install.scopes]
myorg = "http://localhost:4873/"
```

### `//<registry_url>/:<key>=<value>`: Confgure options for a specific registry

Allows you to set options for a specific registry:

```ini
# set an auth token for the registry
# ${...} is a placeholder for environment variables
//http://localhost:4873/:_authToken=${NPM_TOKEN}


# or you could set a username and password
//http://localhost:4873/:username=myusername

//http://localhost:4873/:_password=${NPM_PASSWORD}
```

The following options are supported:

- `_authToken`
- `username`
- `_password`

The equivalent `bunfig.toml` option is to add a key in [`install.scopes`](/docs/runtime/bunfig#install-registry):

```toml
[install.scopes]
myorg = { url = "http://localhost:4873/", username = "myusername", password = "$NPM_PASSWORD" }
```
