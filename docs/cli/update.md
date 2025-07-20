To update all dependencies to the latest version:

```sh
$ bun update
```

To update a specific dependency to the latest version:

```sh
$ bun update [package]
```

## `--interactive`

For a more controlled update experience, use the `--interactive` flag to select which packages to update:

```sh
$ bun update --interactive
$ bun update -i
```

This launches an interactive terminal interface that shows all outdated packages with their current and target versions. You can then select which packages to update.

### Interactive Interface

The interface displays packages in a table format:

```
? Select packages to update - Space to toggle, Enter to confirm, a to select all, n to select none, i to invert, l to toggle latest

□ react                    17.0.2   18.2.0   18.3.1
□ typescript dev           4.8.0    5.0.0    5.3.3
□ @types/node dev          16.11.7  18.0.0   20.11.5
□ lodash optional          4.17.20  4.17.21  4.17.21
```

**Columns:**

- **Package**: Package name with dependency type (`dev`, `peer`, `optional`)
- **Current**: Currently installed version
- **Target**: Version that would be installed (respects semver constraints)
- **Latest**: Latest available version

### Keyboard Controls

**Selection:**

- **Space**: Toggle package selection
- **Enter**: Confirm selections and update
- **a/A**: Select all packages
- **n/N**: Select none
- **i/I**: Invert selection

**Navigation:**

- **↑/↓ Arrow keys** or **j/k**: Move cursor
- **l/L**: Toggle between target and latest version for current package

**Exit:**

- **Ctrl+C** or **Ctrl+D**: Cancel without updating

### Visual Indicators

- **☑** Selected packages (will be updated)
- **□** Unselected packages
- **>** Current cursor position
- **Colors**: Red (major), yellow (minor), green (patch) version changes
- **Underlined**: Currently selected update target

### Package Types

The interface groups and labels packages by their dependency type:

- Regular dependencies (no label)
- `dev` - Development dependencies
- `peer` - Peer dependencies
- `optional` - Optional dependencies

## `--latest`

By default, `bun update` will update to the latest version of a dependency that satisfies the version range specified in your `package.json`.

To update to the latest version, regardless of if it's compatible with the current version range, use the `--latest` flag:

```sh
$ bun update --latest
```

In interactive mode, you can toggle individual packages between their target version (respecting semver) and latest version using the **l** key.

For example, with the following `package.json`:

```json
{
  "dependencies": {
    "react": "^17.0.2"
  }
}
```

- `bun update` would update to a version that matches `17.x`.
- `bun update --latest` would update to a version that matches `18.x` or later.

{% bunCLIUsage command="update" /%}
