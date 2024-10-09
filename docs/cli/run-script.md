The `bun` CLI can be used to execute `package.json` scripts and much more.

The CLI options for this subcommand is identical to [`bun run`](https://bun.sh/docs/cli/run) but is specifically catered to running `package.json` scripts.

This specificity may be useful since if used in a directory with a file or folder that shares a name with a `package.json` script, then `bun run` will prefer attempting to load the path instead and not run the script.

## Example

```sh
$ bun [bun flags] run-script <script> [script flags]
```

Your `package.json` can define a number of named `"scripts"` that correspond to shell commands.

```json
{
  // ... other fields
  "scripts": {
    "clean": "rm -rf dist && echo 'Done.'",
    "dev": "bun server.ts"
  }
}
```

Use `bun run-script <script>` to execute these scripts.

```bash
$ bun run-script clean
 $ rm -rf dist && echo 'Done.'
 Cleaning...
 Done.
```

## See Also

- https://bun.sh/docs/cli/run#run-a-package-json-script
