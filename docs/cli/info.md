`bun info` displays package metadata from the npm registry.

## Usage

```bash
$ bun info react
```

This will display information about the `react` package, including its latest version, description, homepage, dependencies, and more.

## Viewing specific versions

To view information about a specific version:

```bash
$ bun info react@18.0.0
```

## Viewing specific properties

You can also query specific properties from the package metadata:

```bash
$ bun info react version
$ bun info react dependencies
$ bun info react repository.url
```

## JSON output

To get the output in JSON format, use the `--json` flag:

```bash
$ bun info react --json
```

## Alias

`bun pm view` is an alias for `bun info`:

```bash
$ bun pm view react  # equivalent to: bun info react
```

## Examples

```bash
# View basic package information
$ bun info is-number

# View a specific version
$ bun info is-number@7.0.0

# View all available versions
$ bun info is-number versions

# View package dependencies
$ bun info express dependencies

# View package homepage
$ bun info lodash homepage

# Get JSON output
$ bun info react --json
```
