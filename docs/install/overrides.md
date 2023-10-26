Bun supports npm's `"overrides"` and Yarn's `"resolutions"` in `package.json`. These are mechanisms for specifying a version range for _metadependencies_—the dependencies of your dependencies. Refer to [Package manager > Overrides and resolutions](/docs/install/overrides) for complete documentation.

```json-diff#package.json
  {
    "name": "my-app",
    "dependencies": {
      "foo": "^2.0.0"
    },
+   "overrides": {
+     "bar": "~4.4.0"
+   }
  }
```

By default, Bun will install the latest version of all dependencies and metadependencies, according to the ranges specified in each package's `package.json`. Let's say you have a project with one dependency, `foo`, which in turn has a dependency on `bar`. This means `bar` is a _metadependency_ of our project.

```json#package.json
{
  "name": "my-app",
  "dependencies": {
    "foo": "^2.0.0"
  }
}
```

When you run `bun install`, Bun will install the latest versions of each package.

```
# tree layout of node_modules
node_modules
├── foo@1.2.3
└── bar@4.5.6
```

But what if a security vulnerability was introduced in `bar@4.5.6`? We may want a way to pin `bar` to an older version that doesn't have the vulnerability. This is where `"overrides"`/`"resolutions"` come in.

## `"overrides"`

Add `bar` to the `"overrides"` field in `package.json`. Bun will defer to the specified version range when determining which version of `bar` to install, whether it's a dependency or a metadependency.

{% callout %}
**Note** — Bun currently only supports top-level `"overrides"`. [Nested overrides](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides) are not supported.
{% /callout %}

```json-diff#package.json
  {
    "name": "my-app",
    "dependencies": {
      "foo": "^2.0.0"
    },
+   "overrides": {
+     "bar": "~4.4.0"
+   }
  }
```

## `"resolutions"`

The syntax is similar for `"resolutions"`, which is Yarn's alternative to `"overrides"`. Bun supports this feature to make migration from Yarn easier.

As with `"overrides"`, _nested resolutions_ are not currently supported.

```json-diff#package.json
  {
    "name": "my-app",
    "dependencies": {
      "foo": "^2.0.0"
    },
+   "resolutions": {
+     "bar": "~4.4.0"
+   }
  }
```
