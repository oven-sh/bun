## `bun add --global`

{% callout %}
**Note** — This would not modify package.json of your current project folder.
**Alias** - `bun add --global`, `bun add -g`, `bun install --global` and `bun install -g`
{% /callout %}

To install a package globally:

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
# where `bun install --global` installs packages
globalDir = "~/.bun/install/global"

# where globally-installed package bins are linked
globalBinDir = "~/.bun/bin"
```

{% /details %}

