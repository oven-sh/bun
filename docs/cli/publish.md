Use `bun publish` to publish a package to the npm registry.

`bun publish` will automatically pack your package into a tarball, strip catalog and workspace protocols from the `package.json` (resolving versions if necessary), and publish to the registry specified in your configuration files. Both `bunfig.toml` and `.npmrc` files are supported.

```sh
## Publishing the package from the current working directory
$ bun publish

## Output
bun publish v$BUN_LATEST_VERSION (ca7428e9)

packed 203B package.json
packed 224B README.md
packed 30B index.ts
packed 0.64KB tsconfig.json

Total files: 4
Shasum: 79e2b4377b63f4de38dc7ea6e5e9dbee08311a69
Integrity: sha512-6QSNlDdSwyG/+[...]X6wXHriDWr6fA==
Unpacked size: 1.1KB
Packed size: 0.76KB
Tag: latest
Access: default
Registry: http://localhost:4873/

 + publish-1@1.0.0
```

Alternatively, you can pack and publish your package separately by using `bun pm pack` followed by `bun publish` with the path to the output tarball.

```sh
$ bun pm pack
...
$ bun publish ./package.tgz
```

{% callout %}
**Note** - `bun publish` will not run lifecycle scripts (`prepublishOnly/prepack/prepare/postpack/publish/postpublish`) if a tarball path is provided. Scripts will only be run if the package is packed by `bun publish`.
{% /callout %}

### `--access`

The `--access` flag can be used to set the access level of the package being published. The access level can be one of `public` or `restricted`. Unscoped packages are always public, and attempting to publish an unscoped package with `--access restricted` will result in an error.

```sh
$ bun publish --access public
```

`--access` can also be set in the `publishConfig` field of your `package.json`.

```json
{
  "publishConfig": {
    "access": "restricted"
  }
}
```

### `--tag`

Set the tag of the package version being published. By default, the tag is `latest`. The initial version of a package is always given the `latest` tag in addition to the specified tag.

```sh
$ bun publish --tag alpha
```

`--tag` can also be set in the `publishConfig` field of your `package.json`.

```json
{
  "publishConfig": {
    "tag": "next"
  }
}
```

### `--dry-run`

The `--dry-run` flag can be used to simulate the publish process without actually publishing the package. This is useful for verifying the contents of the published package without actually publishing the package.

```sh
$ bun publish --dry-run
```

### `--gzip-level`

Specify the level of gzip compression to use when packing the package. Only applies to `bun publish` without a tarball path argument. Values range from `0` to `9` (default is `9`).
{% bunCLIUsage command="publish" /%}

### `--auth-type`

If you have 2FA enabled for your npm account, `bun publish` will prompt you for a one-time password. This can be done through a browser or the CLI. The `--auth-type` flag can be used to tell the npm registry which method you prefer. The possible values are `web` and `legacy`, with `web` being the default.

```sh
$ bun publish --auth-type legacy
...
This operation requires a one-time password.
Enter OTP: 123456
...
```

### `--otp`

Provide a one-time password directly to the CLI. If the password is valid, this will skip the extra prompt for a one-time password before publishing. Example usage:

```sh
$ bun publish --otp 123456
```

{% callout %}
**Note** - `bun publish` respects the `NPM_CONFIG_TOKEN` environment variable which can be used when publishing in github actions or automated workflows.
{% /callout %}
