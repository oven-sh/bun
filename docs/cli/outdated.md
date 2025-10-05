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

`bun outdated` supports checking catalog dependencies defined in `package.json`:

```sh
$ bun outdated -r
┌────────────────────┬─────────┬─────────┬─────────┬────────────────────────────────┐
│ Package            │ Current │ Update  │ Latest  │ Workspace                      │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ body-parser        │ 1.19.0  │ 1.19.0  │ 2.2.0   │ @test/shared                   │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ cors               │ 2.8.0   │ 2.8.0   │ 2.8.5   │ @test/shared                   │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ chalk              │ 4.0.0   │ 4.0.0   │ 5.6.2   │ @test/utils                    │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ uuid               │ 8.0.0   │ 8.0.0   │ 13.0.0  │ @test/utils                    │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ axios              │ 0.21.0  │ 0.21.0  │ 1.12.2  │ catalog (@test/app)            │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ lodash             │ 4.17.15 │ 4.17.15 │ 4.17.21 │ catalog (@test/app, @test/app) │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ react              │ 17.0.0  │ 17.0.0  │ 19.1.1  │ catalog (@test/app)            │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ react-dom          │ 17.0.0  │ 17.0.0  │ 19.1.1  │ catalog (@test/app)            │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ express            │ 4.17.0  │ 4.17.0  │ 5.1.0   │ catalog (@test/shared)         │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ moment             │ 2.24.0  │ 2.24.0  │ 2.30.1  │ catalog (@test/utils)          │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ @types/node (dev)  │ 14.0.0  │ 14.0.0  │ 24.5.2  │ @test/shared                   │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ @types/react (dev) │ 17.0.0  │ 17.0.0  │ 19.1.15 │ catalog:testing (@test/app)    │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ eslint (dev)       │ 7.0.0   │ 7.0.0   │ 9.36.0  │ catalog:testing (@test/app)    │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ typescript (dev)   │ 4.9.5   │ 4.9.5   │ 5.9.2   │ catalog:build (@test/app)      │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ jest (dev)         │ 26.0.0  │ 26.0.0  │ 30.2.0  │ catalog:testing (@test/shared) │
├────────────────────┼─────────┼─────────┼─────────┼────────────────────────────────┤
│ prettier (dev)     │ 2.0.0   │ 2.0.0   │ 3.6.2   │ catalog:build (@test/utils)    │
└────────────────────┴─────────┴─────────┴─────────┴────────────────────────────────┘
```

{% bunCLIUsage command="outdated" /%}
