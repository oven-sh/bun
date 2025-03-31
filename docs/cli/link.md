Use `bun link` in a local directory to register the current package as a "linkable" package.

```bash
$ cd /path/to/cool-pkg
$ cat package.json
{
  "name": "cool-pkg",
  "version": "1.0.0"
}
$ bun link
bun link v1.x (7416672e)
Success! Registered "cool-pkg"

To use cool-pkg in a project, run:
  bun link cool-pkg

Or add it in dependencies in your package.json file:
  "cool-pkg": "link:cool-pkg"
```

This package can now be "linked" into other projects using `bun link cool-pkg`. This will create a symlink in the `node_modules` directory of the target project, pointing to the local directory.

```bash
$ cd /path/to/my-app
$ bun link cool-pkg
```

In addition, the `--save` flag can be used to add `cool-pkg` to the `dependencies` field of your app's package.json with a special version specifier that tells Bun to load from the registered local directory instead of installing from `npm`:

```json-diff
  {
    "name": "my-app",
    "version": "1.0.0",
    "dependencies": {
+     "cool-pkg": "link:cool-pkg"
    }
  }
```

{% bunCLIUsage command="link" /%}