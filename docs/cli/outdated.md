Use `bun outdated` to check for outdated dependencies in your project. This command displays a table of dependencies that have newer versions available.

{% bunOutdatedTerminal displayGlob="" filter="" glob="" /%}

## Version Information

The output table shows three version columns:

- **Current**: The version currently installed
- **Update**: The latest version that satisfies your package.json version range
- **Latest**: The latest version published to the registry

### Dependency Filters

`bun outdated` supports searching for outdated dependencies by package names and glob patterns.

To check if specific dependencies are outdated, pass the package names as positional arguments:

{% bunOutdatedTerminal displayGlob="eslint-plugin-security eslint-plugin-sonarjs" glob="eslint-plugin-*"  /%}

You can also pass glob patterns to check for outdated packages:

{% bunOutdatedTerminal displayGlob="'eslint*'" glob="eslint*"  /%}

For example, to check for outdated `@types/*` packages:

{% bunOutdatedTerminal displayGlob="'@types/*'" glob="@types/*"  /%}

Or to exclude all `@types/*` packages:

{% bunOutdatedTerminal displayGlob="'!@types/*'" glob="!@types/*"  /%}

### Workspace Filters

Use the `--filter` flag to check for outdated dependencies in a different workspace package:

{% bunOutdatedTerminal  glob="t*" filter="@monorepo/types"  /%}

You can pass multiple `--filter` flags to check multiple workspaces:

{% bunOutdatedTerminal  glob="{e,t}*" displayGlob="--filter @monorepo/types --filter @monorepo/cli" /%}

You can also pass glob patterns to filter by workspace names:

{% bunOutdatedTerminal  glob="{e,t}*" displayGlob="--filter='@monorepo/{types,cli}'" /%}

### Catalog Dependencies

`bun outdated` supports checking catalog dependencies defined in `bunfig.toml`:

```bash
$ bun outdated
┌──────────────────┬──────────┬─────────┬─────────┐
│ Package          │ Current  │ Update  │ Latest  │
├──────────────────┼──────────┼─────────┼─────────┤
│ react (catalog)  │ 18.2.0   │ 18.3.1  │ 18.3.1  │
│ lodash (catalog) │ 4.17.19  │ 4.17.21 │ 4.17.21 │
└──────────────────┴──────────┴─────────┴─────────┘
```

{% bunCLIUsage command="outdated" /%}
