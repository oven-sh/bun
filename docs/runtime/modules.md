Module resolution in JavaScript is a complex topic.

The ecosystem is currently in the midst of a years-long transition from CommonJS modules to native ES modules. TypeScript enforces its own set of rules around import extensions that aren't compatible with ESM. Different build tools support path re-mapping via disparate non-compatible mechanisms.

Bun aims to provide a consistent and predictable module resolution system that just works. Unfortunately it's still quite complex.

## Syntax

Consider the following files.

{% codetabs %}

```ts#index.ts
import { hello } from "./hello";

hello();
```

```ts#hello.ts
export function hello() {
  console.log("Hello world!");
}
```

{% /codetabs %}

When we run `index.ts`, it prints "Hello world".

```bash
$ bun index.ts
Hello world!
```

In this case, we are importing from `./hello`, a relative path with no extension. To resolve this import, Bun will check for the following files in order:

- `./hello.ts`
- `./hello.tsx`
- `./hello.js`
- `./hello.mjs`
- `./hello.cjs`
- `./hello/index.ts`
- `./hello/index.js`
- `./hello/index.json`
- `./hello/index.mjs`

Import paths are case-insensitive.

```ts#index.ts
import { hello } from "./hello";
import { hello } from "./HELLO";
import { hello } from "./hElLo";
```

Import paths can optionally include extensions. If an extension is present, Bun will only check for a file with that exact extension.

```ts#index.ts
import { hello } from "./hello";
import { hello } from "./hello.ts"; // this works
```

There is one exception: if you import `from "*.js{x}"`, Bun will additionally check for a matching `*.ts{x}` file, to be compatible with TypeScript's [ES module support](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-7.html#new-file-extensions).

```ts#index.ts
import { hello } from "./hello";
import { hello } from "./hello.ts"; // this works
import { hello } from "./hello.js"; // this also works
```

Bun supports both ES modules (`import`/`export` syntax) and CommonJS modules (`require()`/`module.exports`). The following CommonJS version would also work in Bun.

{% codetabs %}

```ts#index.js
const { hello } = require("./hello");

hello();
```

```ts#hello.js
function hello() {
  console.log("Hello world!");
}

exports.hello = hello;
```

{% /codetabs %}

That said, using CommonJS is discouraged in new projects.

## Resolution

Bun implements the Node.js module resolution algorithm, so you can import packages from `node_modules` with a bare specifier.

```ts
import { stuff } from "foo";
```

The full specification of this algorithm are officially documented in the [Node.js documentation](https://nodejs.org/api/modules.html); we won't rehash it here. Briefly: if you import `from "foo"`, Bun scans up the file system for a `node_modules` directory containing the package `foo`.

Once it finds the `foo` package, Bun reads the `package.json` to determine how the package should be imported. Unless `"type": "module"` is specified, Bun assumes the package is using CommonJS and transpiles into a synchronous ES module internally. To determine the package's entrypoint, Bun first reads the `exports` field in and checks the following conditions in order:

```jsonc#package.json
{
  "name": "foo",
  "exports": {
    "bun": "./index.js",        // highest priority
    "worker": "./index.js",
    "module": "./index.js",
    "node": "./index.js",
    "browser": "./index.js",
    "default": "./index.js"     // lowest priority
  }
}
```

Bun respects subpath [`"exports"`](https://nodejs.org/api/packages.html#subpath-exports) and [`"imports"`](https://nodejs.org/api/packages.html#imports). Specifying any subpath in the `"exports"` map will prevent other subpaths from being importable.

```jsonc#package.json
{
  "name": "foo",
  "exports": {
    ".": "./index.js",
    "./package.json": "./package.json" # subpath
  }
}
```

{% callout %}
**Shipping TypeScript** — Note that Bun supports the special `"bun"` export condition. If your library is written in TypeScript, you can publish your (un-transpiled!) TypeScript files to `npm` directly. If you specify your package's `*.ts` entrypoint in the `"bun"` condition, Bun will directly import and execute your TypeScript source files.
{% /callout %}

If `exports` is not defined, Bun falls back to `"module"` (ESM imports only) then [`"main"`](https://nodejs.org/api/packages.html#main).

```json#package.json
{
  "name": "foo",
  "module": "./index.js",
  "main": "./index.js"
}
```

## Path re-mapping

In the spirit of treating TypeScript as a first-class citizen, the Bun runtime will re-map import paths according to the [`compilerOptions.paths`](https://www.typescriptlang.org/tsconfig#paths) field in `tsconfig.json`. This is a major divergence from Node.js, which doesn't support any form of import path re-mapping.

```jsonc#tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "config": ["./config.ts"],         // map specifier to file
      "components/*": ["components/*"],  // wildcard matching
    }
  }
}
```

If you aren't a TypeScript user, you can create a [`jsconfig.json`](https://code.visualstudio.com/docs/languages/jsconfig) in your project root to achieve the same behavior.

## Bun-style resolution

{% callout %}
**Note** — Added in Bun v0.3.0
{% /callout %}

If no `node_modules` directory is found in the working directory or higher, Bun will abandon Node.js-style module resolution in favor of the **Bun module resolution algorithm**.

Under Bun-style module resolution, all imported packages are auto-installed on the fly into a [global module cache](/docs/cli/install#global-cache) during execution (the same cache used by [`bun install`](/docs/cli/install)).

```ts
import { foo } from "foo"; // install `latest` version

foo();
```

The first time you run this script, Bun will auto-install `"foo"` and cache it. The next time you run the script, it will use the cached version.

### Version resolution

To determine which version to install, Bun follows the following algorithm:

1. Check for a `bun.lockb` file in the project root. If it exists, use the version specified in the lockfile.
2. Otherwise, scan up the tree for a `package.json` that includes `"foo"` as a dependency. If found, use the specified semver version or version range.
3. Otherwise, use `latest`.

### Cache behavior

Once a version or version range has been determined, Bun will:

1. Check the module cache for a compatible version. If one exists, use it.
2. When resolving `latest`, Bun will check if `package@latest` has been downloaded and cached in the last _24 hours_. If so, use it.
3. Otherwise, download and install the appropriate version from the `npm` registry.

### Installation

Packages are installed and cached into `<cache>/<pkg>@<version>`, so multiple versions of the same package can be cached at once. Additional, a symlink is created under `<cache>/<pkg>/<version>` to make it faster to look up all versions of a package exist in the cache.

### Version specifiers

This entire resolution algorithm can be short-circuited by specifying a version or version range directly in your import statement.

```ts
import { z } from "zod@3.0.0"; // specific version
import { z } from "zod@next"; // npm tag
import { z } from "zod@^3.20.0"; // semver range
```

### Benefits

This auto-installation approach is useful for a few reasons:

- **Space efficiency** — Each version of a dependency only exists in one place on disk. This is a huge space and time savings compared to redundant per-project installations.
- **Portability** — To share simple scripts and gists, your source file is _self-contained_. No need to `zip` together a directory containing your code and config files. With version specifiers in `import` statements, even a `package.json` isn't necessary.
- **Convenience** — There's no need to run `npm install` or `bun install` before running a file or script. Just `bun run` it.
- **Backwards compatibility** — Because Bun still respects the versions specified in `package.json` if one exists, you can switch to Bun-style resolution with a single command: `rm -rf node_modules`.

### Limitations

- No Intellisense. TypeScript auto-completion in IDEs relies on the existence of type declaration files inside `node_modules`. We are investigating various solutions to this.
- No [patch-package](https://github.com/ds300/patch-package) support

<!-- - The implementation details of Bun's install cache will change between versions. Don't think of it as an API. To reliably resolve packages, use Bun's builtin APIs (such as `Bun.resolveSync` or `import.meta.resolve`) instead of relying on the filesystem directly. Bun will likely move to a binary archive format where packages may not correspond to files/folders on disk at all - so if you depend on the filesystem structure instead of the JavaScript API, your code will eventually break. -->

<!-- ### Customizing behavior

To prefer locally-installed versions of packages. Instead of checking npm for latest versions, you can pass the `--prefer-offline` flag to prefer locally-installed versions of packages.

```bash
$ bun run --prefer-offline my-script.ts
```

This will check the install cache for installed versions of packages before checking the npm registry. If no matching version of a package is installed, only then will it check npm for the latest version.

#### Prefer latest

To always use the latest version of a package, you can pass the `--prefer-latest` flag.

```bash
$ bun run --prefer-latest my-script.ts
``` -->

### FAQ

{% details summary="How is this different from what pnpm does?" %}

With pnpm, you have to run `pnpm install`, which creates a `node_modules` folder of symlinks for the runtime to resolve. By contrast, Bun resolves dependencies on the fly when you run a file; there's no need to run any `install` command ahead of time. Bun also doesn't create a `node_modules` folder.

{% /details %}

{% details summary="How is this different from Yarn Plug'N'Play does?" %}
With Yarn, you must run `yarn install` before you run a script. By contrast, Bun resolves dependencies on the fly when you run a file; there's no need to run any `install` command ahead of time.

Yarn Plug'N'Play also uses zip files to store dependencies. This makes dependency loading [slower at runtime](https://twitter.com/jarredsumner/status/1458207919636287490), as random access reads on zip files tend to be slower than the equivalent disk lookup.
{% /details %}

{% details summary="How is this different from what Deno does?" %}

Deno requires an `npm:` specifier before each npm `import`, lacks support for import maps via `compilerOptions.paths` in `tsconfig.json`, and has incomplete support for `package.json` settings. Unlike Deno, Bun does not currently support URL imports.
{% /details %}
