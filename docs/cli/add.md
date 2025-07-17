To add a particular package:

```bash
$ bun add preact
```

To specify a version, version range, or tag:

```bash
$ bun add zod@3.20.0
$ bun add zod@^3.0.0
$ bun add zod@latest
```

## `--dev`

{% callout %}
**Alias** — `--development`, `-d`, `-D`
{% /callout %}

To add a package as a dev dependency (`"devDependencies"`):

```bash
$ bun add --dev @types/react
$ bun add -d @types/react
```

## `--optional`

To add a package as an optional dependency (`"optionalDependencies"`):

```bash
$ bun add --optional lodash
```

## `--peer`

To add a package as a peer dependency (`"peerDependencies"`):

```bash
$ bun add --peer @types/bun
```

## `--exact`

{% callout %}
**Alias** — `-E`
{% /callout %}

To add a package and pin to the resolved version, use `--exact`. This will resolve the version of the package and add it to your `package.json` with an exact version number instead of a version range.

```bash
$ bun add react --exact
$ bun add react -E
```

This will add the following to your `package.json`:

```jsonc
{
  "dependencies": {
    // without --exact
    "react": "^18.2.0", // this matches >= 18.2.0 < 19.0.0

    // with --exact
    "react": "18.2.0", // this matches only 18.2.0 exactly
  },
}
```

To view a complete list of options for this command:

```bash
$ bun add --help
```

## `--global`

{% callout %}
**Note** — This would not modify package.json of your current project folder.
**Alias** - `bun add --global`, `bun add -g`, `bun install --global` and `bun install -g`
{% /callout %}

To install a package globally, use the `-g`/`--global` flag. This will not modify the `package.json` of your current project. Typically this is used for installing command-line tools.

```bash
$ bun add --global cowsay # or `bun add -g cowsay`
$ cowsay "Bun!"
 ______
< Bun! >
 ------
        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||
```

{% details summary="Configuring global installation behavior" %}

```toml
[install]
# where `bun add --global` installs packages
globalDir = "~/.bun/install/global"

# where globally-installed package bins are linked
globalBinDir = "~/.bun/bin"
```

{% /details %}

## Trusted dependencies

Unlike other npm clients, Bun does not execute arbitrary lifecycle scripts for installed dependencies, such as `postinstall`. These scripts represent a potential security risk, as they can execute arbitrary code on your machine.

To tell Bun to allow lifecycle scripts for a particular package, add the package to `trustedDependencies` in your package.json.

```json-diff
  {
    "name": "my-app",
    "version": "1.0.0",
+   "trustedDependencies": ["my-trusted-package"]
  }
```

Bun reads this field and will run lifecycle scripts for `my-trusted-package`.

<!-- Bun maintains an allow-list of popular packages containing `postinstall` scripts that are known to be safe. To run lifecycle scripts for packages that aren't on this list, add the package to `trustedDependencies` in your package.json. -->

## Git dependencies

To add a dependency from a public or private git repository:

```bash
$ bun add git@github.com:moment/moment.git
```

{% callout %}
**Note** — To install private repositories, your system needs the appropriate SSH credentials to access the repository.
{% /callout %}

Bun supports a variety of protocols, including [`github`](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#github-urls), [`git`](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#git-urls-as-dependencies), `git+ssh`, `git+https`, and many more.

```json
{
  "dependencies": {
    "dayjs": "git+https://github.com/iamkun/dayjs.git",
    "lodash": "git+ssh://github.com/lodash/lodash.git#4.17.21",
    "moment": "git@github.com:moment/moment.git",
    "zod": "github:colinhacks/zod"
  }
}
```

## Tarball dependencies

A package name can correspond to a publicly hosted `.tgz` file. During installation, Bun will download and install the package from the specified tarball URL, rather than from the package registry.

```sh
$ bun add zod@https://registry.npmjs.org/zod/-/zod-3.21.4.tgz
```

This will add the following line to your `package.json`:

```json#package.json
{
  "dependencies": {
    "zod": "https://registry.npmjs.org/zod/-/zod-3.21.4.tgz"
  }
}
```

{% bunCLIUsage command="add" /%}
