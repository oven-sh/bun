## Reference

### `bun install`

bun install is a fast package manager & npm client.

bun install can be configured via `bunfig.toml`, environment variables, and CLI flags.

#### Configuring bun install with `bunfig.toml`

`bunfig.toml` is searched for in the following paths on `bun install`, `bun remove`, and `bun add`:

1. `$XDG_CONFIG_HOME/.bunfig.toml` or `$HOME/.bunfig.toml`
2. `./bunfig.toml`

<sup>If both are found, the results are merged together.</sup>

Configuring with `bunfig.toml` is optional. bun tries to be zero configuration in general, but that's not always possible.

```toml
# Using scoped packages with bun install
[install.scopes]

# Scope name      The value can be a URL string or an object
"@mybigcompany" = { token = "123456", url = "https://registry.mybigcompany.com" }
# URL is optional and fallsback to the default registry

# The "@" in the scope is optional
mybigcompany2 = { token = "123456" }

# Environment variables can be referenced as a string that starts with $ and it will be replaced
mybigcompany3 = { token = "$npm_config_token" }

# Setting username and password turns it into a Basic Auth header by taking base64("username:password")
mybigcompany4 = { username = "myusername", password = "$npm_config_password", url = "https://registry.yarnpkg.com/" }
# You can set username and password in the registry URL. This is the same as above.
mybigcompany5 = "https://username:password@registry.yarnpkg.com/"

# You can set a token for a registry URL:
mybigcompany6 = "https://:$NPM_CONFIG_TOKEN@registry.yarnpkg.com/"

[install]
# Default registry
# can be a URL string or an object
registry = "https://registry.yarnpkg.com/"
# as an object
#registry = { url = "https://registry.yarnpkg.com/", token = "123456" }

# Install for production? This is the equivalent to the "--production" CLI argument
production = false

# Don't actually install
dryRun = true

# Install optionalDependencies (default: true)
optional = true

# Install local devDependencies (default: true)
dev = true

# Install peerDependencies (default: false)
peer = false

# When using `bun install -g`, install packages here
globalDir = "~/.bun/install/global"

# When using `bun install -g`, link package bins here
globalBinDir = "~/.bun/bin"

# cache-related configuration
[install.cache]
# The directory to use for the cache
dir = "~/.bun/install/cache"

# Don't load from the global cache.
# Note: bun may still write to node_modules/.cache
disable = false

# Always resolve the latest versions from the registry
disableManifest = false


# Lockfile-related configuration
[install.lockfile]

# Print a yarn v1 lockfile
# Note: it does not load the lockfile, it just converts bun.lockb into a yarn.lock
print = "yarn"

# Path to read bun.lockb from
path = "bun.lockb"

# Path to save bun.lockb to
savePath = "bun.lockb"

# Save the lockfile to disk
save = true

```

If it's easier to read as TypeScript types:

```ts
export interface Root {
  install: Install;
}

export interface Install {
  scopes: Scopes;
  registry: Registry;
  production: boolean;
  dryRun: boolean;
  optional: boolean;
  dev: boolean;
  peer: boolean;
  globalDir: string;
  globalBinDir: string;
  cache: Cache;
  lockfile: Lockfile;
  logLevel: "debug" | "error" | "warn";
}

type Registry =
  | string
  | {
      url?: string;
      token?: string;
      username?: string;
      password?: string;
    };

type Scopes = Record<string, Registry>;

export interface Cache {
  dir: string;
  disable: boolean;
  disableManifest: boolean;
}

export interface Lockfile {
  print?: "yarn";
  path: string;
  savePath: string;
  save: boolean;
}
```

#### Configuring with environment variables

Environment variables have a higher priority than `bunfig.toml`.

| Name                             | Description                                                   |
| -------------------------------- | ------------------------------------------------------------- |
| BUN_CONFIG_REGISTRY              | Set an npm registry (default: <https://registry.npmjs.org>)   |
| BUN_CONFIG_TOKEN                 | Set an auth token (currently does nothing)                    |
| BUN_CONFIG_LOCKFILE_SAVE_PATH    | File path to save the lockfile to (default: bun.lockb)        |
| BUN_CONFIG_YARN_LOCKFILE         | Save a Yarn v1-style yarn.lock                                |
| BUN_CONFIG_LINK_NATIVE_BINS      | Point `bin` in package.json to a platform-specific dependency |
| BUN_CONFIG_SKIP_SAVE_LOCKFILE    | Don’t save a lockfile                                         |
| BUN_CONFIG_SKIP_LOAD_LOCKFILE    | Don’t load a lockfile                                         |
| BUN_CONFIG_SKIP_INSTALL_PACKAGES | Don’t install any packages                                    |

bun always tries to use the fastest available installation method for the target platform. On macOS, that’s `clonefile` and on Linux, that’s `hardlink`. You can change which installation method is used with the `--backend` flag. When unavailable or on error, `clonefile` and `hardlink` fallsback to a platform-specific implementation of copying files.

bun stores installed packages from npm in `~/.bun/install/cache/${name}@${version}`. Note that if the semver version has a `build` or a `pre` tag, it is replaced with a hash of that value instead. This is to reduce the chances of errors from long file paths but unfortunately complicates figuring out where a package was installed on disk.

When the `node_modules` folder exists, before installing, bun checks if the `"name"` and `"version"` in `package/package.json` in the expected node_modules folder matches the expected `name` and `version`. This is how it determines whether or not it should install. It uses a custom JSON parser which stops parsing as soon as it finds `"name"` and `"version"`.

When a `bun.lockb` doesn’t exist or `package.json` has changed dependencies, tarballs are downloaded & extracted eagerly while resolving.

When a `bun.lockb` exists and `package.json` hasn’t changed, bun downloads missing dependencies lazily. If the package with a matching `name` & `version` already exists in the expected location within `node_modules`, bun won’t attempt to download the tarball.

#### Platform-specific dependencies?

bun stores normalized `cpu` and `os` values from npm in the lockfile, along with the resolved packages. It skips downloading, extracting, and installing packages disabled for the current target at runtime. This means the lockfile won’t change between platforms/architectures even if the packages ultimately installed do change.

#### Peer dependencies?

Peer dependencies are handled similarly to yarn. `bun install` does not automatically install peer dependencies and will try to choose an existing dependency.

#### Lockfile

`bun.lockb` is bun’s binary lockfile format.

#### Why is it binary?

In a word: Performance. bun’s lockfile saves & loads incredibly quickly, and saves a lot more data than what is typically inside lockfiles.

#### How do I inspect it?

For now, the easiest thing is to run `bun install -y`. That prints a Yarn v1-style yarn.lock file.

#### What does the lockfile store?

Packages, metadata for those packages, the hoisted install order, dependencies for each package, what packages those dependencies resolved to, an integrity hash (if available), what each package was resolved to and which version (or equivalent)

#### Why is it fast?

It uses linear arrays for all data. [Packages](https://github.com/Jarred-Sumner/bun/blob/be03fc273a487ac402f19ad897778d74b6d72963/src/install/install.zig#L1825) are referenced by auto-incrementing integer ID or a hash of the package name. Strings longer than 8 characters are de-duplicated. Prior to saving on disk, the lockfile is garbage-collected & made deterministic by walking the package tree and cloning the packages in dependency order.

#### Cache

To delete the cache:

```bash
rm -rf ~/.bun/install/cache
```

#### npm registry metadata

bun uses a binary format for caching NPM registry responses. This loads much faster than JSON and tends to be smaller on disk.
You will see these files in `~/.bun/install/cache/*.npm`. The filename pattern is `${hash(packageName)}.npm`. It’s a hash so that extra directories don’t need to be created for scoped packages.

bun’s usage of `Cache-Control` ignores `Age`. This improves performance but means bun may be about 5 minutes out of date to receive the latest package version metadata from npm.

### `bun run`

`bun run` is a fast `package.json` script runner. Instead of waiting 170ms for your npm client to start every time, you wait 6ms for bun.

By default, `bun run` prints the script that will be invoked:

```bash
bun run clean
$ rm -rf node_modules/.cache dist
```

You can disable that with `--silent`

```bash
bun run --silent clean
```

`bun run ${script-name}` runs the equivalent of `npm run script-name`. For example, `bun run dev` runs the `dev` script in `package.json`, which may sometimes spin up non-bun processes.

`bun run ${javascript-file.js}` will run it with bun, as long as the file doesn't have a node shebang.

To print a list of `scripts`, `bun run` without additional args:

```bash
# This command
bun run

# Prints this
hello-create-react-app scripts:

bun run start
react-scripts start

bun run build
react-scripts build

bun run test
react-scripts test

bun run eject
react-scripts eject

4 scripts
```

`bun run` automatically loads environment variables from `.env` into the shell/task. `.env` files are loaded with the same priority as the rest of bun, so that means:

1. `.env.local` is first
2. if (`$NODE_ENV` === `"production"`) `.env.production` else `.env.development`
3. `.env`

If something is unexpected there, you can run `bun run env` to get a list of environment variables.

The default shell it uses is `bash`, but if that’s not found, it tries `sh` and if still not found, it tries `zsh`. This is not configurable right now, but if you care file an issue.

`bun run` automatically adds any parent `node_modules/.bin` to `$PATH` and if no scripts match, it will load that binary instead. That means you can run executables from packages too.

```bash
# If you use Relay
bun run relay-compiler

# You can also do this, but:
# - It will only lookup packages in `node_modules/.bin` instead of `$PATH`
# - It will start bun’s dev server if the script name doesn’t exist (`bun` starts the dev server by default)
bun relay-compiler
```

To pass additional flags through to the task or executable, there are two ways:

```bash
# Explicit: include "--" and anything after will be added. This is the recommended way because it is more reliable.
bun run relay-compiler -- -–help

# Implicit: if you do not include "--", anything *after* the script name will be passed through
# bun flags are parsed first, which means e.g. `bun run relay-compiler --help` will print bun’s help instead of relay-compiler’s help.
bun run relay-compiler --schema foo.graphql
```

`bun run` supports lifecycle hooks like `post${task}` and `pre{task}`. If they exist, they will run matching the behavior of npm clients. If the `pre${task}` fails, the next task will not be run. There is currently no flag to skip these lifecycle tasks if they exist, if you want that file an issue.

### `bun create`

`bun create` is a fast way to create a new project from a template.

At the time of writing, `bun create react app` runs ~11x faster on my local computer than `yarn create react-app app`. `bun create` currently does no caching (though your npm client does)

#### Usage

Create a new Next.js project:

```bash
bun create next ./app
```

Create a new React project:

```bash
bun create react ./app
```

Create from a GitHub repo:

```bash
bun create ahfarmer/calculator ./app
```

To see a list of examples, run:

```bash
bun create
```

Format:

```bash
bun create github-user/repo-name destination
bun create local-example-or-remote-example destination
bun create /absolute/path/to-template-folder destination
bun create https://github.com/github-user/repo-name destination
bun create github.com/github-user/repo-name destination
```

Note: you don’t need `bun create` to use bun. You don’t need any configuration at all. This command exists to make it a little easier.

#### Local templates

If you have your own boilerplate you prefer using, copy it into `$HOME/.bun-create/my-boilerplate-name`.

Before checking bun’s examples folder, `bun create` checks for a local folder matching the input in:

- `$BUN_CREATE_DIR/`
- `$HOME/.bun-create/`
- `$(pwd)/.bun-create/`

If a folder exists in any of those folders with the input, bun will use that instead of a remote template.

To create a local template, run:

```bash
mkdir -p $HOME/.bun-create/new-template-name
echo '{"name":"new-template-name"}' > $HOME/.bun-create/new-template-name/package.json
```

This lets you run:

```bash
bun create new-template-name ./app
```

Now your new template should appear when you run:

```bash
bun create
```

Warning: unlike with remote templates, **bun will delete the entire destination folder if it already exists.**

#### Flags

| Flag         | Description                            |
| ------------ | -------------------------------------- |
| --npm        | Use `npm` for tasks & install          |
| --yarn       | Use `yarn` for tasks & install         |
| --pnpm       | Use `pnpm` for tasks & install         |
| --force      | Overwrite existing files               |
| --no-install | Skip installing `node_modules` & tasks |
| --no-git     | Don’t initialize a git repository      |
| --open       | Start & open in-browser after finish   |

| Environment Variables | Description                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| GITHUB_API_DOMAIN     | If you’re using a GitHub enterprise or a proxy, you can change what the endpoint requests to GitHub go |
| GITHUB_API_TOKEN      | This lets `bun create` work with private repositories or if you get rate-limited                       |

By default, `bun create` will cancel if there are existing files it would overwrite and it's a remote template. You can pass `--force` to disable this behavior.

#### Publishing a new template

Clone this repository and a new folder in `examples/` with your new template. The `package.json` must have a `name` that starts with `@bun-examples/`. Do not worry about publishing it, that will happen automatically after the PR is merged.

Make sure to include a `.gitignore` that includes `node_modules` so that `node_modules` aren’t checked in to git when people download the template.

#### Testing your new template

To test your new template, add it as a local template or pass the absolute path.

```bash
bun create /path/to/my/new/template destination-dir
```

Warning: **This will always delete everything in destination-dir**.

#### Config

The `bun-create` section of `package.json` is automatically removed from the `package.json` on disk. This lets you add create-only steps without waiting for an extra package to install.

There are currently two options:

- `postinstall`
- `preinstall`

They can be an array of strings or one string. An array of steps will be executed in order.

Here is an example:

```json
{
  "name": "@bun-examples/next",
  "version": "0.0.31",
  "main": "index.js",
  "dependencies": {
    "next": "11.1.2",
    "react": "^17.0.2",
    "react-dom": "^17.0.2",
    "react-is": "^17.0.2"
  },
  "devDependencies": {
    "@types/react": "^17.0.19",
    "bun-framework-next": "^0.0.0-21",
    "typescript": "^4.3.5"
  },
  "bun-create": {
    "postinstall": ["bun bun --use next"]
  }
}
```

By default, all commands run inside the environment exposed by the auto-detected npm client. This incurs a significant performance penalty, something like 150ms spent waiting for the npm client to start on each invocation.

Any command that starts with `"bun "` will be run without npm, relying on the first `bun` binary in `$PATH`.

#### How `bun create` works

When you run `bun create ${template} ${destination}`, here’s what happens:

IF remote template

1. GET `registry.npmjs.org/@bun-examples/${template}/latest` and parse it
2. GET `registry.npmjs.org/@bun-examples/${template}/-/${template}-${latestVersion}.tgz`
3. Decompress & extract `${template}-${latestVersion}.tgz` into `${destination}`

   - If there are files that would overwrite, warn and exit unless `--force` is passed

IF github repo

1. Download the tarball from GitHub’s API
2. Decompress & extract into `${destination}`

   - If there are files that would overwrite, warn and exit unless `--force` is passed

ELSE IF local template

1. Open local template folder
2. Delete destination directory recursively
3. Copy files recursively using the fastest system calls available (on macOS `fcopyfile` and Linux, `copy_file_range`). Do not copy or traverse into `node_modules` folder if exists (this alone makes it faster than `cp`)

4. Parse the `package.json` (again!), update `name` to be `${basename(destination)}`, remove the `bun-create` section from the `package.json` and save the updated `package.json` to disk.
   - IF Next.js is detected, add `bun-framework-next` to the list of dependencies
   - IF Create React App is detected, add the entry point in /src/index.{js,jsx,ts,tsx} to `public/index.html`
   - IF Relay is detected, add `bun-macro-relay` so that Relay works
5. Auto-detect the npm client, preferring `pnpm`, `yarn` (v1), and lastly `npm`
6. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
7. Run `${npmClient} install` unless `--no-install` is passed OR no dependencies are in package.json
8. Run any tasks defined in `"bun-create": { "preinstall" }` with the npm client
9. Run `git init; git add -A .; git commit -am "Initial Commit";`

   - Rename `gitignore` to `.gitignore`. NPM automatically removes `.gitignore` files from appearing in packages.
   - If there are dependencies, this runs in a separate thread concurrently while node_modules are being installed
   - Using libgit2 if available was tested and performed 3x slower in microbenchmarks

10. Done

`misctools/publish-examples.js` publishes all examples to npm.

### `bun bun`

Run `bun bun ./path-to.js` to generate a `node_modules.bun` file containing all imported dependencies (recursively).

#### Why bundle?

- For browsers, loading entire apps without bundling dependencies is typically slow. With a fast bundler & transpiler, the bottleneck eventually becomes the web browser’s ability to run many network requests concurrently. There are many workarounds for this. `<link rel="modulepreload">`, HTTP/3, etc but none are more effective than bundling. If you have reproducible evidence to the contrary, feel free to submit an issue. It would be better if bundling wasn’t necessary.
- On the server, bundling reduces the number of filesystem lookups to load JavaScript. While filesystem lookups are faster than HTTP requests, there’s still overhead.

#### What is `.bun`?

Note: [This format may change soon](https://github.com/Jarred-Sumner/bun/issues/121)

The `.bun` file contains:

- all the bundled source code
- all the bundled source code metadata
- project metadata & configuration

Here are some of the questions `.bun` files answer:

- when I import `react/index.js`, where in the `.bun` is the code for that? (not resolving, just the code)
- what modules of a package are used?
- what framework is used? (e.g. Next.js)
- where is the routes directory?
- how big is each imported dependency?
- what is the hash of the bundle’s contents? (for etags)
- what is the name & version of every npm package exported in this bundle?
- what modules from which packages are used in this project? ("project" is defined as all the entry points used to generate the .bun)

All in one file.

It’s a little like a build cache but designed for reuse across builds.

#### Position-independent code

From a design perspective, the most important part of the `.bun` format is how code is organized. Each module is exported by a hash like this:

```js
// preact/dist/preact.module.js
export var $eb6819b = $$m({
  "preact/dist/preact.module.js": (module, exports) => {
    var n, l, u, i, t, o, r, f, e = {}, c = [], s = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
    // ... rest of code
```

This makes bundled modules [position-independent](https://en.wikipedia.org/wiki/Position-independent_code). In theory, one could import only the exact modules in-use without reparsing code and without generating a new bundle. One bundle can dynamically become many bundles comprising only the modules in use on the webpage. Thanks to the metadata with the byte offsets, a web server can send each module to browsers [zero-copy](https://en.wikipedia.org/wiki/Zero-copy) using [sendfile](https://man7.org/linux/man-pages/man2/sendfile.2.html). bun itself is not quite this smart yet, but these optimizations would be useful in production and potentially very useful for React Server Components.

To see the schema inside, have a look at [`JavascriptBundleContainer`](./src/api/schema.d.ts#:~:text=export%20interface-,JavascriptBundleContainer,-%7B). You can find JavaScript bindings to read the metadata in [src/api/schema.js](./src/api/schema.js). This is not really an API yet. It’s missing the part where it gets the binary data from the bottom of the file. Someday, I want this to be usable by other tools too.

#### Where is the code?

`.bun` files are marked as executable.

To print out the code, run `./node_modules.bun` in your terminal or run `bun ./path-to-node_modules.bun`.

Here is a copy-pastable example:

```bash
./node_modules.bun > node_modules.js
```

This works because every `.bun` file starts with this:

```bash
#!/usr/bin/env bun
```

To deploy to production with bun, you’ll want to get the code from the `.bun` file and stick that somewhere your web server can find it (or if you’re using Vercel or a Rails app, in a `public` folder).

Note that `.bun` is a binary file format, so just opening it in VSCode or vim might render strangely.

#### Advanced

By default, `bun bun` only bundles external dependencies that are `import`ed or `require`d in either app code or another external dependency. An "external dependency" is defined as, "A JavaScript-like file that has `/node_modules/` in the resolved file path and a corresponding `package.json`".

To force bun to bundle packages which are not located in a `node_modules` folder (i.e. the final, resolved path following all symlinks), add a `bun` section to the root project’s `package.json` with `alwaysBundle` set to an array of package names to always bundle. Here’s an example:

```json
{
  "name": "my-package-name-in-here",
  "bun": {
    "alwaysBundle": ["@mybigcompany/my-workspace-package"]
  }
}
```

Bundled dependencies are not eligible for Hot Module Reloading. The code is served to browsers & bun.js verbatim. But, in the future, it may be sectioned off into only parts of the bundle being used. That’s possible in the current version of the `.bun` file (so long as you know which files are necessary), but it’s not implemented yet. Longer-term, it will include all `import` and `export` of each module inside.

#### What is the module ID hash?

The `$eb6819b` hash used here:

```js
export var $eb6819b = $$m({
```

Is generated like this:

1. Murmur3 32-bit hash of `package.name@package.version`. This is the hash uniquely identifying the npm package.
2. Wyhash 64 of the `package.hash` + `package_path`. `package_path` means "relative to the root of the npm package, where is the module imported?". For example, if you imported `react/jsx-dev-runtime.js`, the `package_path` is `jsx-dev-runtime.js`. `react-dom/cjs/react-dom.development.js` would be `cjs/react-dom.development.js`
3. Truncate the hash generated above to a `u32`

The implementation details of this module ID hash will vary between versions of bun. The important part is the metadata contains the module IDs, the package paths, and the package hashes so it shouldn’t really matter in practice if other tooling wants to make use of any of this.

### `bun upgrade`

To upgrade bun, run `bun upgrade`.

It automatically downloads the latest version of bun and overwrites the currently-running version.

This works by checking the latest version of bun in [bun-releases-for-updater](https://github.com/Jarred-Sumner/bun-releases-for-updater/releases) and unzipping it using the system-provided `unzip` library (so that Gatekeeper works on macOS)

If for any reason you run into issues, you can also use the curl install script:

```bash
curl https://bun.sh/install | bash
```

It will still work when bun is already installed.

bun is distributed as a single binary file, so you can also do this manually:

- Download the latest version of bun for your platform in [bun-releases-for-updater](https://github.com/Jarred-Sumner/bun-releases-for-updater/releases/latest) (`darwin` == macOS)
- Unzip the folder
- Move the `bun` binary to `~/.bun/bin` (or anywhere)

### `bun completions`

This command installs completions for `zsh` and/or `fish`. It’s run automatically on every `bun upgrade` and on install. It reads from `$SHELL` to determine which shell to install for. It tries several common shell completion directories for your shell and OS.

If you want to copy the completions manually, run `bun completions > path-to-file`. If you know the completions directory to install them to, run `bun completions /path/to/directory`.

## `Bun.serve` - fast HTTP server

For a hello world HTTP server that writes "bun!", `Bun.serve` serves about 2.5x more requests per second than node.js on Linux:

| Requests per second | Runtime |
| ------------------- | ------- |
| ~64,000             | Node 16 |
| ~160,000            | Bun     |

<sup>Bigger is better</sup>

<details>
<summary>Code</summary>

Bun:

```ts
Bun.serve({
  fetch(req: Request) {
    return new Response(`bun!`);
  },
  port: 3000,
});
```

Node:

```ts
require("http")
  .createServer((req, res) => res.end("bun!"))
  .listen(8080);
```

<img width="499" alt="image" src="https://user-images.githubusercontent.com/709451/162389032-fc302444-9d03-46be-ba87-c12bd8ce89a0.png">

</details>

#### Usage

Two ways to start an HTTP server with bun.js:

1. `export default` an object with a `fetch` function

If the file used to start bun has a default export with a `fetch` function, it will start the HTTP server.

```ts
// hi.js
export default {
  fetch(req) {
    return new Response("HI!");
  },
};

// bun ./hi.js
```

`fetch` receives a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) object and must return either a [`Response` ](https://developer.mozilla.org/en-US/docs/Web/API/Response) or a [`Promise<Response>`](https://developer.mozilla.org/en-US/docs/Web/API/Response). In a future version, it might have additional arguments for things like cookies.

2. `Bun.serve` starts the HTTP server explicitly

```ts
Bun.serve({
  fetch(req) {
    return new Response("HI!");
  },
});
```

#### Error handling

For error handling, you get an `error` function.

If `development: true` and `error` is not defined or doesn't return a `Response`, you will get an exception page with a stack trace:

<img width="687" alt="image" src="https://user-images.githubusercontent.com/709451/162382958-23614e8f-239c-4ba6-be75-b76ceef8227c.png">

It will hopefully make it easier to debug issues with bun until bun gets debugger support. This error page is based on what `bun dev` does.

**If the error function returns a `Response`, it will be served instead**

```js
Bun.serve({
  fetch(req) {
    throw new Error("woops!");
  },
  error(error: Error) {
    return new Response("Uh oh!!\n" + error.toString(), { status: 500 });
  },
});
```

**If the `error` function itself throws and `development` is `false`, a generic 500 page will be shown**

To stop the server, call `server.stop()`:

```ts
const server = Bun.serve({
  fetch() {
    return new Response("HI!");
  },
});

server.stop();
```

The interface for `Bun.serve` is based on what [Cloudflare Workers](https://developers.cloudflare.com/workers/learning/migrating-to-module-workers/#module-workers-in-the-dashboard) does.

## `Bun.write` – optimizing I/O

`Bun.write` lets you write, copy or pipe files automatically using the fastest system calls compatible with the input and platform.

```ts
interface Bun {
  write(
    destination: string | number | FileBlob,
    input: string | FileBlob | Blob | ArrayBufferView
  ): Promise<number>;
}
```

| Output                     | Input          | System Call                   | Platform |
| -------------------------- | -------------- | ----------------------------- | -------- |
| file                       | file           | copy_file_range               | Linux    |
| file                       | pipe           | sendfile                      | Linux    |
| pipe                       | pipe           | splice                        | Linux    |
| terminal                   | file           | sendfile                      | Linux    |
| terminal                   | terminal       | sendfile                      | Linux    |
| socket                     | file or pipe   | sendfile (if http, not https) | Linux    |
| file (path, doesn't exist) | file (path)    | clonefile                     | macOS    |
| file                       | file           | fcopyfile                     | macOS    |
| file                       | Blob or string | write                         | macOS    |
| file                       | Blob or string | write                         | Linux    |

All this complexity is handled by a single function.

```ts
// Write "Hello World" to output.txt
await Bun.write("output.txt", "Hello World");
```

```ts
// log a file to stdout
await Bun.write(Bun.stdout, Bun.file("input.txt"));
```

```ts
// write the HTTP response body to disk
await Bun.write("index.html", await fetch("http://example.com"));
// this does the same thing
await Bun.write(Bun.file("index.html"), await fetch("http://example.com"));
```

```ts
// copy input.txt to output.txt
await Bun.write("output.txt", Bun.file("input.txt"));
```

## bun:sqlite (SQLite3 module)

`bun:sqlite` is a high-performance builtin [SQLite3](https://www.sqlite.org/) module for bun.js.

- Simple, synchronous API (synchronous _is_ faster)
- Transactions
- Binding named & positional parameters
- Prepared statements
- Automatic type conversions (`BLOB` becomes `Uint8Array`)
- toString() prints as SQL

Installation:

```sh
# there's nothing to install
# bun:sqlite is builtin to bun.js
```

Example:

```ts
import { Database } from "bun:sqlite";

const db = new Database("mydb.sqlite");
db.run(
  "CREATE TABLE IF NOT EXISTS foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)"
);
db.run("INSERT INTO foo (greeting) VALUES (?)", "Welcome to bun!");
db.run("INSERT INTO foo (greeting) VALUES (?)", "Hello World!");

// get the first row
db.query("SELECT * FROM foo").get();
// { id: 1, greeting: "Welcome to bun!" }

// get all rows
db.query("SELECT * FROM foo").all();
// [
//   { id: 1, greeting: "Welcome to bun!" },
//   { id: 2, greeting: "Hello World!" },
// ]

// get all rows matching a condition
db.query("SELECT * FROM foo WHERE greeting = ?").all("Welcome to bun!");
// [
//   { id: 1, greeting: "Welcome to bun!" },
// ]

// get first row matching a named condition
db.query("SELECT * FROM foo WHERE greeting = $greeting").get({
  $greeting: "Welcome to bun!",
});
// [
//   { id: 1, greeting: "Welcome to bun!" },
// ]
```

### bun:sqlite Benchmark

Database: [Northwind Traders](https://github.com/jpwhite3/northwind-SQLite3/blob/master/Northwind_large.sqlite.zip).

This benchmark can be run from [./bench/sqlite](./bench/sqlite).

Here are results from an M1 Pro (64GB) on macOS 12.3.1.

**SELECT \* FROM "Order"**

| Library            | Runtime     | ms/iter              |
| ------------------ | ----------- | -------------------- |
| bun:sqlite3        | Bun 0.0.83  | 14.31 (1x)           |
| better-sqlite3     | Node 18.0.0 | 40.81 (2.8x slower)  |
| deno.land/x/sqlite | Deno 1.21.2 | 125.96 (8.9x slower) |

**SELECT \* FROM "Product"**

| Library            | Runtime     | us/iter              |
| ------------------ | ----------- | -------------------- |
| bun:sqlite3        | Bun 0.0.83  | 33.85 (1x)           |
| better-sqlite3     | Node 18.0.0 | 121.09 (3.5x slower) |
| deno.land/x/sqlite | Deno 1.21.2 | 187.64 (8.9x slower) |

**SELECT \* FROM "OrderDetail"**

| Library            | Runtime     | ms/iter              |
| ------------------ | ----------- | -------------------- |
| bun:sqlite3        | Bun 0.0.83  | 146.92 (1x)          |
| better-sqlite3     | Node 18.0.0 | 875.73 (5.9x slower) |
| deno.land/x/sqlite | Deno 1.21.2 | 541.15 (3.6x slower) |

In screenshot form (which has a different sorting order)

<img width="738" alt="image" src="https://user-images.githubusercontent.com/709451/168459263-8cd51ca3-a924-41e9-908d-cf3478a3b7f3.png">

### Getting started with bun:sqlite

bun:sqlite's API is loosely based on [better-sqlite3](https://github.com/JoshuaWise/better-sqlite3), though the implementation is different.

bun:sqlite has two classes:

- `class Database`
- `class Statement`

#### `Database`

Calling `new Database(filename)` opens or creates the SQLite database.

```ts
constructor(
      filename: string,
      options?:
        | number
        | {
            /**
             * Open the database as read-only (no write operations, no create).
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READONLY}
             */
            readonly?: boolean;
            /**
             * Allow creating a new database
             *
             * Equivalent to {@link constants.SQLITE_OPEN_CREATE}
             */
            create?: boolean;
            /**
             * Open the database as read-write
             *
             * Equivalent to {@link constants.SQLITE_OPEN_READWRITE}
             */
            readwrite?: boolean;
          }
    );
```

To open or create a SQLite3 database:

```ts
import { Database } from "bun:sqlite";

const db = new Database("mydb.sqlite");
```

Open an in-memory database:

```ts
import { Database } from "bun:sqlite";

// all of these do the same thing
var db = new Database(":memory:");
var db = new Database();
var db = new Database("");
```

Open read-write and throw if the database doesn't exist:

```ts
import { Database } from "bun:sqlite";
const db = new Database("mydb.sqlite", { readwrite: true });
```

Open read-only and throw if the database doesn't exist:

```ts
import { Database } from "bun:sqlite";
const db = new Database("mydb.sqlite", { readonly: true });
```

Open read-write, don't throw if new file:

```ts
import { Database } from "bun:sqlite";
const db = new Database("mydb.sqlite", { readonly: true, create: true });
```

Open a database from a `Uint8Array`:

```ts
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";

// unlike passing a filepath, this will not persist any changes to disk
// it will be read-write but not persistent
const db = new Database(readFileSync("mydb.sqlite"));
```

Close a database:

```ts
var db = new Database();
db.close();
```

Note: `close()` is called automatically when the database is garbage collected. It is safe to call multiple times but has no effect after the first.

#### Database.prototype.query

`query(sql)` creates a `Statement` for the given SQL and caches it, but does not execute it.

```ts
class Database {
  query(sql: string): Statement;
}
```

`query` returns a `Statement` object.

It performs the same operation as `Database.prototype.prepare`, except:

- `query` caches the prepared statement in the `Database` object
- `query` doesn't bind parameters

This intended to make it easier for `bun:sqlite` to be fast by default. Calling `.prepare` compiles a SQLite query, which can take some time, so it's better to cache those a little.

You can bind parameters on any call to a statement.

```js
import { Database } from "bun:sqlite";

// generate some data
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)"
);
db.run("INSERT INTO foo (greeting) VALUES ($greeting)", {
  $greeting: "Welcome to bun",
});

// get the query
const stmt = db.query("SELECT * FROM foo WHERE greeting = ?");

// run the query
stmt.all("Welcome to bun!");
stmt.get("Welcome to bun!");
stmt.run("Welcome to bun!");
```

#### Database.prototype.prepare

`prepare(sql)` creates a `Statement` for the given SQL, but does not execute it.

Unlike `query()`, this does not cache the compiled query.

```ts
import { Database } from "bun:sqlite";

// generate some data
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)"
);

// compile the prepared statement
const stmt = db.prepare("SELECT * FROM foo WHERE bar = ?");

// run the prepared statement
stmt.all("baz");
```

Internally, this calls [`sqlite3_prepare_v3`](https://www.sqlite.org/c3ref/prepare.html).

#### Database.prototype.exec & Database.prototype.run

`exec` is for one-off executing a query which does not need to return anything.
`run` is an alias.

```ts
class Database {
  // exec is an alias for run
  exec(sql: string, ...params: ParamsType): void;
  run(sql: string, ...params: ParamsType): void;
}
```

This is useful for things like

Creating a table:

```ts
import { Database } from "bun:sqlite";

var db = new Database();
db.exec(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)"
);
```

Inserting one row:

```ts
import { Database } from "bun:sqlite";

var db = new Database();
db.exec(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)"
);

// insert one row
db.exec("INSERT INTO foo (greeting) VALUES ($greeting)", {
  $greeting: "Welcome to bun",
});
```

For queries which aren't intended to be run multiple times, it should be faster to use `exec()` than `prepare()` or `query()` because it doesn't create a `Statement` object.

Internally, this function calls [`sqlite3_prepare`](https://www.sqlite.org/c3ref/prepare.html), [`sqlite3_step`](https://www.sqlite.org/c3ref/step.html), and [`sqlite3_finalize`](https://www.sqlite.org/c3ref/finalize.html).

#### Database.prototype.transaction

Creates a function that always runs inside a transaction. When the function is invoked, it will begin a new transaction. When the function returns, the transaction will be committed. If an exception is thrown, the transaction will be rolled back (and the exception will propagate as usual).

```ts
// setup
import { Database } from "bun:sqlite";
const db = Database.open(":memory:");
db.exec(
  "CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)"
);

const insert = db.prepare("INSERT INTO cats (name, age) VALUES ($name, $age)");
const insertMany = db.transaction((cats) => {
  for (const cat of cats) insert.run(cat);
});

insertMany([
  { $name: "Joey", $age: 2 },
  { $name: "Sally", $age: 4 },
  { $name: "Junior", $age: 1 },
]);
```

Transaction functions can be called from inside other transaction functions. When doing so, the inner transaction becomes a savepoint.

```ts
// setup
import { Database } from "bun:sqlite";
const db = Database.open(":memory:");
db.exec(
  "CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT, dollars INTEGER);"
);
db.exec(
  "CREATE TABLE cats (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, age INTEGER)"
);
const newExpense = db.prepare(
  "INSERT INTO expenses (note, dollars) VALUES (?, ?)"
);
const insert = db.prepare("INSERT INTO cats (name, age) VALUES ($name, $age)");
const insertMany = db.transaction((cats) => {
  for (const cat of cats) insert.run(cat);
});

const adopt = db.transaction((cats) => {
  newExpense.run("adoption fees", 20);
  insertMany(cats); // nested transaction
});

adopt([
  { $name: "Joey", $age: 2 },
  { $name: "Sally", $age: 4 },
  { $name: "Junior", $age: 1 },
]);
```

Transactions also come with `deferred`, `immediate`, and `exclusive` versions.

```ts
insertMany(cats); // uses "BEGIN"
insertMany.deferred(cats); // uses "BEGIN DEFERRED"
insertMany.immediate(cats); // uses "BEGIN IMMEDIATE"
insertMany.exclusive(cats); // uses "BEGIN EXCLUSIVE"
```

Any arguments passed to the transaction function will be forwarded to the wrapped function, and any values returned from the wrapped function will be returned from the transaction function. The wrapped function will also have access to the same binding as the transaction function.

bun:sqlite's transaction implementation is based on [better-sqlite3](https://github.com/JoshuaWise/better-sqlite3/blob/master/docs/api.md#transactionfunction---function) (along with this section of the docs), so thanks to Joshua Wise and better-sqlite3 contributors.

#### Database.prototype.serialize

SQLite has a builtin way to [serialize](https://www.sqlite.org/c3ref/serialize.html) and [deserialize](https://www.sqlite.org/c3ref/deserialize.html) databases to and from memory.

`bun:sqlite` fully supports it:

```ts
var db = new Database();

// write some data
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)"
);
db.run("INSERT INTO foo VALUES (?)", "Welcome to bun!");
db.run("INSERT INTO foo VALUES (?)", "Hello World!");

const copy = db.serialize();
// => Uint8Array

const db2 = new Database(copy);
db2.query("SELECT * FROM foo").all();
// => [
//   { id: 1, greeting: "Welcome to bun!" },
//   { id: 2, greeting: "Hello World!" },
// ]
```

`db.serialize()` returns a `Uint8Array` of the database.

Internally, it calls [`sqlite3_serialize`](https://www.sqlite.org/c3ref/serialize.html).

#### Database.prototype.loadExtension

`bun:sqlite` supports [SQLite extensions](https://www.sqlite.org/loadext.html).

To load a SQLite extension, call `Database.prototype.loadExtension(name)`:

```ts
import { Database } from "bun:sqlite";

var db = new Database();

db.loadExtension("myext");
```

If you're on macOS, you will need to first use a custom SQLite install (you can install with homebrew). By default, bun uses Apple's proprietary build of SQLite because it benchmarks about 50% faster. However, they disabled extension support, so you will need to have a custom build of SQLite to use extensions on macOS.

```ts
import { Database } from "bun:sqlite";

// on macOS, this must be run before any other calls to `Database`
// if called on linux, it will return true and do nothing
// on linux it will still check that a string was passed
Database.setCustomSQLite("/path/to/sqlite.dylib");

var db = new Database();

db.loadExtension("myext");
```

To install sqlite with homebrew:

```bash
brew install sqlite
```

#### Statement

`Statement` is a prepared statement. Use it to run queries that get results.

TLDR:

- [`Statement.all(...optionalParamsToBind)`](#statementall) returns all rows as an array of objects
- [`Statement.values(...optionalParamsToBind)`](#statementvalues) returns all rows as an array of arrays
- [`Statement.get(...optionalParamsToBind)`](#statementget) returns the first row as an object
- [`Statement.run(...optionalParamsToBind)`](#statementrun) runs the statement and returns nothing
- [`Statement.finalize()`](#statementfinalize) closes the statement
- [`Statement.toString()`](#statementtostring) prints the expanded SQL, including bound parameters
- `get Statement.columnNames` get the returned column names
- `get Statement.paramsCount` how many parameters are expected?

You can bind parameters on any call to a statement. Named parameters and positional parameters are supported. Bound parameters are remembered between calls and reset the next time you pass parameters to bind.

```ts
import { Database } from "bun:sqlite";

// setup
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT)"
);
db.run("INSERT INTO foo VALUES (?)", "Welcome to bun!");
db.run("INSERT INTO foo VALUES (?)", "Hello World!");

// Statement object
var statement = db.query("SELECT * FROM foo");

// returns all the rows
statement.all();

// returns the first row
statement.get();

// runs the query, without returning anything
statement.run();
```

#### Statement.all

Calling `all()` on a `Statement` instance runs the query and returns the rows as an array of objects.

```ts
import { Database } from "bun:sqlite";

// setup
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT, count INTEGER)"
);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Welcome to bun!", 2);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Hello World!", 0);
db.run(
  "INSERT INTO foo (greeting, count) VALUES (?, ?)",
  "Welcome to bun!!!!",
  2
);

// Statement object
var statement = db.query("SELECT * FROM foo WHERE count = ?");

// return all the query results, binding 2 to the count parameter
statement.all(2);
// => [
//   { id: 1, greeting: "Welcome to bun!", count: 2 },
//   { id: 3, greeting: "Welcome to bun!!!!", count: 2 },
// ]
```

Internally, this calls [`sqlite3_reset`](https://www.sqlite.org/capi3ref.html#sqlite3_reset) and repeatedly calls [`sqlite3_step`](https://www.sqlite.org/capi3ref.html#sqlite3_step) until it returns `SQLITE_DONE`.

#### Statement.values

Calling `values()` on a `Statement` instance runs the query and returns the rows as an array of arrays.

```ts
import { Database } from "bun:sqlite";

// setup
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT, count INTEGER)"
);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Welcome to bun!", 2);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Hello World!", 0);
db.run(
  "INSERT INTO foo (greeting, count) VALUES (?, ?)",
  "Welcome to bun!!!!",
  2
);

// Statement object
var statement = db.query("SELECT * FROM foo WHERE count = ?");

// return all the query results as an array of arrays, binding 2 to "count"
statement.values(2);
// => [
//   [ 1, "Welcome to bun!", 2 ],
//   [ 3, "Welcome to bun!!!!", 2 ],
// ]

// Statement object, but with named parameters
var statement = db.query("SELECT * FROM foo WHERE count = $count");

// return all the query results as an array of arrays, binding 2 to "count"
statement.values({ $count: 2 });
// => [
//   [ 1, "Welcome to bun!", 2 ],
//   [ 3, "Welcome to bun!!!!", 2 ],
// ]
```

Internally, this calls [`sqlite3_reset`](https://www.sqlite.org/capi3ref.html#sqlite3_reset) and repeatedly calls [`sqlite3_step`](https://www.sqlite.org/capi3ref.html#sqlite3_step) until it returns `SQLITE_DONE`.

#### Statement.get

Calling `get()` on a `Statement` instance runs the query and returns the first result as an object.

```ts
import { Database } from "bun:sqlite";

// setup
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT, count INTEGER)"
);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Welcome to bun!", 2);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Hello World!", 0);
db.run(
  "INSERT INTO foo (greeting, count) VALUES (?, ?)",
  "Welcome to bun!!!!",
  2
);

// Statement object
var statement = db.query("SELECT * FROM foo WHERE count = ?");

// return the first row as an object, binding 2 to the count parameter
statement.get(2);
// => { id: 1, greeting: "Welcome to bun!", count: 2 }

// Statement object, but with named parameters
var statement = db.query("SELECT * FROM foo WHERE count = $count");

// return the first row as an object, binding 2 to the count parameter
statement.get({ $count: 2 });
// => { id: 1, greeting: "Welcome to bun!", count: 2 }
```

Internally, this calls [`sqlite3_reset`](https://www.sqlite.org/capi3ref.html#sqlite3_reset) and calls [`sqlite3_step`](https://www.sqlite.org/capi3ref.html#sqlite3_step) once. Stepping through all the rows is not necessary when you only want the first row.

#### Statement.run

Calling `run()` on a `Statement` instance runs the query and returns nothing.

This is useful if you want to repeatedly run a query, but don't care about the results.

```ts
import { Database } from "bun:sqlite";

// setup
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT, count INTEGER)"
);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Welcome to bun!", 2);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Hello World!", 0);
db.run(
  "INSERT INTO foo (greeting, count) VALUES (?, ?)",
  "Welcome to bun!!!!",
  2
);

// Statement object (TODO: use a better example query)
var statement = db.query("SELECT * FROM foo");

// run the query, returning nothing
statement.run();
```

Internally, this calls [`sqlite3_reset`](https://www.sqlite.org/capi3ref.html#sqlite3_reset) and calls [`sqlite3_step`](https://www.sqlite.org/capi3ref.html#sqlite3_step) once. Stepping through all the rows is not necessary when you don't care about the results.

#### Statement.finalize

This method finalizes the statement, freeing any resources associated with it.

After a statement has been finalized, it cannot be used for any further queries. Any attempt to run the statement will throw an error. Calling it multiple times will have no effect.

It is a good idea to finalize a statement when you are done with it, but the garbage collector will do it for you if you don't.

```ts
import { Database } from "bun:sqlite";

// setup
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT, count INTEGER)"
);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Welcome to bun!", 2);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Hello World!", 0);
db.run(
  "INSERT INTO foo (greeting, count) VALUES (?, ?)",
  "Welcome to bun!!!!",
  2
);

// Statement object
var statement = db.query("SELECT * FROM foo WHERE count = ?");

statement.finalize();

// this will throw
statement.run();
```

#### Statement.toString()

Calling `toString()` on a `Statement` instance prints the expanded SQL query. This is useful for debugging.

```ts
import { Database } from "bun:sqlite";

// setup
var db = new Database();
db.run(
  "CREATE TABLE foo (id INTEGER PRIMARY KEY AUTOINCREMENT, greeting TEXT, count INTEGER)"
);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Welcome to bun!", 2);
db.run("INSERT INTO foo (greeting, count) VALUES (?, ?)", "Hello World!", 0);
db.run(
  "INSERT INTO foo (greeting, count) VALUES (?, ?)",
  "Welcome to bun!!!!",
  2
);

// Statement object
const statement = db.query("SELECT * FROM foo WHERE count = ?");

console.log(statement.toString());
// => "SELECT * FROM foo WHERE count = NULL"

statement.run(2); // bind the param

console.log(statement.toString());
// => "SELECT * FROM foo WHERE count = 2"
```

Internally, this calls [`sqlite3_expanded_sql`](https://www.sqlite.org/capi3ref.html#sqlite3_expanded_sql).

#### Datatypes

| JavaScript type | SQLite type            |
| --------------- | ---------------------- |
| `string`        | `TEXT`                 |
| `number`        | `INTEGER` or `DECIMAL` |
| `boolean`       | `INTEGER` (1 or 0)     |
| `Uint8Array`    | `BLOB`                 |
| `Buffer`        | `BLOB`                 |
| `bigint`        | `INTEGER`              |
| `null`          | `NULL`                 |

### `bun:ffi` (Foreign Functions Interface)

`bun:ffi` lets you efficiently call native libraries from JavaScript. It works with languages that support the C ABI (Zig, Rust, C/C++, C#, Nim, Kotlin, etc).

This snippet prints sqlite3's version number:

```ts
import { dlopen, FFIType, suffix } from "bun:ffi";

// `suffix` is either "dylib", "so", or "dll" depending on the platform
// you don't have to use "suffix", it's just there for convenience
const path = `libsqlite3.${suffix}`;

const {
  symbols: {
    // sqlite3_libversion is the function we will call
    sqlite3_libversion,
  },
} =
  // dlopen() expects:
  // 1. a library name or file path
  // 2. a map of symbols
  dlopen(path, {
    // `sqlite3_libversion` is a function that returns a string
    sqlite3_libversion: {
      // sqlite3_libversion takes no arguments
      args: [],
      // sqlite3_libversion returns a pointer to a string
      returns: FFIType.cstring,
    },
  });

console.log(`SQLite 3 version: ${sqlite3_libversion()}`);
```

#### Low-overhead FFI

3ns to go from JavaScript <> native code with `bun:ffi` (on my machine, an M1 Pro with 64GB of RAM)

- 5x faster than napi (Node v17.7.1)
- 100x faster than Deno v1.21.1

As measured in [this simple benchmark](./bench/ffi/plus100)

<img src="https://user-images.githubusercontent.com/709451/166429741-e6d83ca5-3808-4397-acb7-bb2c9f4329be.png" height="400">

<details>

<summary>Why is bun:ffi fast?</summary>

Bun generates & just-in-time compiles C bindings that efficiently convert values between JavaScript types and native types.

To compile C, Bun embeds [TinyCC](https://github.com/TinyCC/tinycc) a small and fast C compiler.

</details>

#### Usage

With Zig:

```zig
// add.zig
pub export fn add(a: i32, b: i32) i32 {
  return a + b;
}
```

To compile:

```bash
zig build-lib add.zig -dynamic -OReleaseFast
```

Pass `dlopen` the path to the shared library and the list of symbols you want to import.

```ts
import { dlopen, FFIType, suffix } from "bun:ffi";

const path = `libadd.${suffix}`;

const lib = dlopen(path, {
  add: {
    args: [FFIType.i32, FFIType.i32],
    returns: FFIType.i32,
  },
});

lib.symbols.add(1, 2);
```

With Rust:

```rust
// add.rs
#[no_mangle]
pub extern "C" fn add(a: isize, b: isize) -> isize {
    a + b
}
```

To compile:

```bash
rustc --crate-type cdylib add.rs
```

#### Supported FFI types (`FFIType`)

| `FFIType` | C Type     | Aliases                     |
| --------- | ---------- | --------------------------- |
| cstring   | `char*`    |                             |
| ptr       | `void*`    | `pointer`, `void*`, `char*` |
| i8        | `int8_t`   | `int8_t`                    |
| i16       | `int16_t`  | `int16_t`                   |
| i32       | `int32_t`  | `int32_t`, `int`            |
| i64       | `int64_t`  | `int32_t`                   |
| u8        | `uint8_t`  | `uint8_t`                   |
| u16       | `uint16_t` | `uint16_t`                  |
| u32       | `uint32_t` | `uint32_t`                  |
| u64       | `uint64_t` | `uint32_t`                  |
| f32       | `float`    | `float`                     |
| f64       | `double`   | `double`                    |
| bool      | `bool`     |                             |
| char      | `char`     |                             |

#### Strings (`CString`)

JavaScript strings and C-like strings are different, and that complicates using strings with native libraries.

<details>
<summary>How are JavaScript strings and C strings different?</summary>

JavaScript strings:

- UTF16 (2 bytes per letter) or potentially latin1, depending on the JavaScript engine &amp; what characters are used
- `length` stored separately
- Immutable

C strings:

- UTF8 (1 byte per letter), usually
- The length is not stored. Instead, the string is null-terminated which means the length is the index of the first `\0` it finds
- Mutable

</details>

To help with that, `bun:ffi` exports `CString` which extends JavaScript's builtin `String` to support null-terminated strings and add a few extras:

```ts
class CString extends String {
  /**
   * Given a `ptr`, this will automatically search for the closing `\0` character and transcode from UTF-8 to UTF-16 if necessary.
   */
  constructor(ptr: number, byteOffset?: number, byteLength?: number): string;

  /**
   * The ptr to the C string
   *
   * This `CString` instance is a clone of the string, so it
   * is safe to continue using this instance after the `ptr` has been
   * freed.
   */
  ptr: number;
  byteOffset?: number;
  byteLength?: number;
}
```

To convert from a null-terminated string pointer to a JavaScript string:

```ts
const myString = new CString(ptr);
```

To convert from a pointer with a known length to a JavaScript string:

```ts
const myString = new CString(ptr, 0, byteLength);
```

`new CString` clones the C string, so it is safe to continue using `myString` after `ptr` has been freed.

```ts
my_library_free(myString.ptr);

// this is safe because myString is a clone
console.log(myString);
```

##### Returning a string

When used in `returns`, `FFIType.cstring` coerces the pointer to a JavaScript `string`. When used in `args`, `cstring` is identical to `ptr`.

#### Function pointers (`CFunction`)

To call a function pointer from JavaScript, use `CFunction`

This is useful if using Node-API (napi) with Bun and you've already loaded some of the symbols.

```ts
import { CFunction } from "bun:ffi";

var myNativeLibraryGetVersion = /* somehow, you got this pointer */

const getVersion = new CFunction({
  returns: "cstring",
  args: [],
  ptr: myNativeLibraryGetVersion,
});
getVersion();
```

If you have multiple function pointers, you can define them all at once with `linkSymbols`:

```ts
import { linkSymbols } from "bun:ffi";

// getVersionPtrs defined elsewhere
const [majorPtr, minorPtr, patchPtr] = getVersionPtrs();

const lib = linkSymbols({
  // Unlike with dlopen(), the names here can be whatever you want
  getMajor: {
    returns: "cstring",
    args: [],

    // Since this doesn't use dlsym(), you have to provide a valid ptr
    // That ptr could be a number or a bigint
    // An invalid pointer will crash your program.
    ptr: majorPtr,
  },
  getMinor: {
    returns: "cstring",
    args: [],
    ptr: minorPtr,
  },
  getPatch: {
    returns: "cstring",
    args: [],
    ptr: patchPtr,
  },
});

const [major, minor, patch] = [
  lib.symbols.getMajor(),
  lib.symbols.getMinor(),
  lib.symbols.getPatch(),
];
```

#### Pointers

Bun represents [pointers](<https://en.wikipedia.org/wiki/Pointer_(computer_programming)>) as a `number` in JavaScript.

<details>

<summary>How does a 64 bit pointer fit in a JavaScript number?</summary>

64-bit processors support up to [52 bits of addressable space](https://en.wikipedia.org/wiki/64-bit_computing#Limits_of_processors).

[JavaScript numbers](https://en.wikipedia.org/wiki/Double-precision_floating-point_format#IEEE_754_double-precision_binary_floating-point_format:_binary64) support 53 bits of usable space, so that leaves us with about 11 bits of extra space.

Why not `BigInt`?

`BigInt` is slower. JavaScript engines allocate a separate `BigInt` which means they can't just fit in a regular javascript value.

If you pass a `BigInt` to a function, it will be converted to a `number`

</details>

**To convert from a TypedArray to a pointer**:

```ts
import { ptr } from "bun:ffi";
var myTypedArray = new Uint8Array(32);
const myPtr = ptr(myTypedArray);
```

**To convert from a pointer to an ArrayBuffer**:

```ts
import { ptr, toArrayBuffer } from "bun:ffi";
var myTypedArray = new Uint8Array(32);
const myPtr = ptr(myTypedArray);

// toTypedArray accepts a `byteOffset` and `byteLength`
// if `byteLength` is not provided, it is assumed to be a null-terminated pointer
myTypedArray = new Uint8Array(toArrayBuffer(myPtr, 0, 32), 0, 32);
```

**Pointers & memory safety**

Using raw pointers outside of FFI is extremely not recommended.

A future version of bun may add a CLI flag to disable `bun:ffi` (or potentially a separate build of bun).

**Pointer alignment**

If an API expects a pointer sized to something other than `char` or `u8`, make sure the typed array is also that size.

A `u64*` is not exactly the same as `[8]u8*` due to alignment

##### Passing a pointer

Where FFI functions expect a pointer, pass a TypedArray of equivalent size

Easymode:

```ts
import { dlopen, FFIType } from "bun:ffi";

const {
  symbols: { encode_png },
} = dlopen(myLibraryPath, {
  encode_png: {
    // FFIType's can be specified as strings too
    args: ["ptr", "u32", "u32"],
    returns: FFIType.ptr,
  },
});

const pixels = new Uint8ClampedArray(128 * 128 * 4);
pixels.fill(254);
pixels.subarray(0, 32 * 32 * 2).fill(0);

const out = encode_png(
  // pixels will be passed as a pointer
  pixels,

  128,
  128
);
```

The [auto-generated wrapper](https://github.com/Jarred-Sumner/bun/blob/c6d732eee2721cd6191672cbe2c57fb17c3fffe4/src/bun.js/ffi.exports.js#L146-L148) converts the pointer to a TypedArray

<details>

<summary>Hardmode</summary>

If you don't want the automatic conversion or you want a pointer to a specific byte offset within the TypedArray, you can also directly get the pointer to the TypedArray:

```ts
import { dlopen, FFIType, ptr } from "bun:ffi";

const {
  symbols: { encode_png },
} = dlopen(myLibraryPath, {
  encode_png: {
    // FFIType's can be specified as strings too
    args: ["ptr", "u32", "u32"],
    returns: FFIType.ptr,
  },
});

const pixels = new Uint8ClampedArray(128 * 128 * 4);
pixels.fill(254);

// this returns a number! not a BigInt!
const myPtr = ptr(pixels);

const out = encode_png(
  myPtr,

  // dimensions:
  128,
  128
);
```

</details>

##### Reading pointers

```ts
const out = encode_png(
  // pixels will be passed as a pointer
  pixels,

  // dimensions:
  128,
  128
);

// assuming it is 0-terminated, it can be read like this:
var png = new Uint8Array(toArrayBuffer(out));

// save it to disk:
await Bun.write("out.png", png);
```

##### Not implemented yet

`bun:ffi` has a few more things planned but not implemented yet:

- callback functions
- async functions

### Node-API (napi)

Bun.js implements 90% of the APIs available in [Node-API](https://nodejs.org/api/n-api.html) (napi).

You can see the status of [this here](https://github.com/Jarred-Sumner/bun/issues/158).

Loading Node-API modules in Bun.js works the same as in Node.js:

```js
const napi = require("./my-node-module.node");
```

You can also use `process.dlopen`:

```js
var mod = { exports: {} };
process.dlopen(mod, "./my-node-module.node");
```

As part of that work, Bun.js also polyfills the [`detect-libc`](https://npmjs.com/package/detect-libc) package, which is used by many Node-API modules to detect which `.node` binding to `require`.

This implementation of Node-API is from scratch. It doesn't use any code from Node.js.

**Some implementation details**

When requiring a `*.node` module, Bun's JavaScript transpiler transforms the `require` expression into call to `import.meta.require`:

```js
// this is the input
require("./my-node-module.node");

// this is the output
import.meta.require("./my-node-module.node");
```

Bun doesn't currently support dynamic requires, but `import.meta.require` is an escape hatch for that. It uses a [JavaScriptCore builtin function](https://github.com/Jarred-Sumner/bun/blob/aa87d40f4b7fdfb52575f44d151906ddba6a82d0/src/bun.js/bindings/builtins/js/JSZigGlobalObject.js#L26).

### `Bun.Transpiler`

`Bun.Transpiler` lets you use Bun's transpiler from JavaScript (available in Bun.js)

````ts
type Loader = "jsx" | "js" | "ts" | "tsx";

interface TranspilerOptions {
  // Replace key with value. Value must be a JSON string.
  // @example
  // ```
  // { "process.env.NODE_ENV": "\"production\"" }
  // ```
  define: Record<string, string>,

  // What is the default loader used for this transpiler?
  loader: Loader,

  // What platform are we targeting? This may affect how import and/or require is used
  platform: "browser" | "bun" | "macro" | "node",

  // TSConfig.json file as stringified JSON or an object
  // Use this to set a custom JSX factory, fragment, or import source
  // For example, if you want to use Preact instead of React. Or if you want to use Emotion.
  tsconfig: string | TSConfig,

  // Replace imports with macros
  macros: MacroMap,
}

// This lets you use macros
interface MacroMap {
  // @example
  // ```
  // {
  //   "react-relay": {
  //     "graphql": "bun-macro-relay/bun-macro-relay.tsx"
  //   }
  // }
  // ```
  [packagePath: string]: {
    [importItemName: string]: string,
  },
}

class Bun.Transpiler {
  constructor(options: TranspilerOptions)

  transform(code: string, loader?: Loader): Promise<string>
  transformSync(code: string, loader?: Loader): string

  scan(code: string): {exports: string[], imports: Import}
  scanImports(code: string): Import[]
}

type Import = {
  path: string,
  kind:
  // import foo from 'bar'; in JavaScript
  | "import-statement"
  // require("foo") in JavaScript
  | "require-call"
  // require.resolve("foo") in JavaScript
  | "require-resolve"
  // Dynamic import() in JavaScript
  | "dynamic-import"
  // @import() in CSS
  | "import-rule"
  // url() in CSS
  | "url-token"
  // The import was injected by Bun
  | "internal"
  // Entry point
  // Probably won't see this one
  | "entry-point"
}

const transpiler = new Bun.Transpiler({ loader: "jsx" });
````

#### `Bun.Transpiler.transformSync`

This lets you transpile JavaScript, TypeScript, TSX, and JSX using Bun's transpiler. It does not resolve modules.

It is synchronous and runs in the same thread as other JavaScript code.

```js
const transpiler = new Bun.Transpiler({ loader: "jsx" });
transpiler.transformSync("<div>hi!</div>");
```

```js
import { __require as require } from "bun:wrap";
import * as JSX from "react/jsx-dev-runtime";
var jsx = require(JSX).jsxDEV;

export default jsx(
  "div",
  {
    children: "hi!",
  },
  undefined,
  false,
  undefined,
  this
);
```

If a macro is used, it will be run in the same thread as the transpiler, but in a separate event loop from the rest of your application. Currently, globals between macros and regular code are shared, which means it is possible (but not recommended) to share states between macros and regular code. Attempting to use AST nodes outside of a macro is undefined behavior.

#### `Bun.Transpiler.transform`

This lets you transpile JavaScript, TypeScript, TSX, and JSX using Bun's transpiler. It does not resolve modules.

It is async and automatically runs in Bun's worker threadpool. That means if you run it 100 times, it will run it across `Math.floor($cpu_count * 0.8)` threads without blocking the main JavaScript thread.

If code uses a macro, it will potentially spawn a new copy of Bun.js' JavaScript runtime environment in that new thread.

Unless you're transpiling _many_ large files, you should probably use `Bun.Transpiler.transformSync`. The cost of the threadpool will often take longer than actually transpiling code.

```js
const transpiler = new Bun.Transpiler({ loader: "jsx" });
await transpiler.transform("<div>hi!</div>");
```

```js
import { __require as require } from "bun:wrap";
import * as JSX from "react/jsx-dev-runtime";
var jsx = require(JSX).jsxDEV;

export default jsx(
  "div",
  {
    children: "hi!",
  },
  undefined,
  false,
  undefined,
  this
);
```

You can also pass a `Loader` as a string

```js
await transpiler.transform("<div>hi!</div>", "tsx");
```

#### `Bun.Transpiler.scan`

This is a fast way to get a list of imports & exports used in a JavaScript/jsx or TypeScript/tsx file.

This function is synchronous.

```ts
const transpiler = new Bun.Transpiler({ loader: "ts" });

transpiler.scan(`
import React from 'react';
import Remix from 'remix';
import type {ReactNode} from 'react';

export const loader = () => import('./loader');
`);
```

```ts
{
  "exports": [
    "loader"
  ],
  "imports": [
    {
      "kind": "import-statement",
      "path": "react"
    },
    {
      "kind": "import-statement",
      "path": "remix"
    },
    {
      "kind": "dynamic-import",
      "path": "./loader"
    }
  ]
}

```

#### `Bun.Transpiler.scanImports`

This is a fast path for getting a list of imports used in a JavaScript/jsx or TypeScript/tsx file. It skips the visiting pass, which means it is faster but less accurate. You probably won't notice a difference between `Bun.Transpiler.scan` and `Bun.Transpiler.scanImports` often. You might notice it for very large files (megabytes).

This function is synchronous.

```ts
const transpiler = new Bun.Transpiler({ loader: "ts" });

transpiler.scanImports(`
import React from 'react';
import Remix from 'remix';
import type {ReactNode} from 'react';

export const loader = () => import('./loader');
`);
```

```json
[
  {
    "kind": "import-statement",
    "path": "react"
  },
  {
    "kind": "import-statement",
    "path": "remix"
  },
  {
    "kind": "dynamic-import",
    "path": "./loader"
  }
]
```

## Environment variables

- `GOMAXPROCS`: For `bun bun`, this sets the maximum number of threads to use. If you’re experiencing an issue with `bun bun`, try setting `GOMAXPROCS=1` to force bun to run single-threaded
- `DISABLE_BUN_ANALYTICS=1` this disables bun’s analytics. bun records bundle timings (so we can answer with data, "is bun getting faster?") and feature usage (e.g. "are people actually using macros?"). The request body size is about 60 bytes, so it’s not a lot of data
- `TMPDIR`: Before `bun bun` completes, it stores the new `.bun` in `$TMPDIR`. If unset, `TMPDIR` defaults to the platform-specific temporary directory (on Linux, `/tmp` and on macOS `/private/tmp`)
