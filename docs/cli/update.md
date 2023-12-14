To update all dependencies to the latest version _that's compatible with the version range specified in your `package.json`_:

```sh
$ bun update
```

## `--force`

{% callout %}
**Alias** — `-f`
{% /callout %}

By default, Bun respects the version range defined in your package.json. To ignore this and update to the latest version, you can pass in the `force` flag.

```sh
$ bun update --force
```
