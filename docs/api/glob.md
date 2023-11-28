Bun includes a fast native implementation of file globbing.

## Quickstart

**Scan a directory for files matching `*.ts`**:

```ts
import { Glob } from "bun";

const glob = new Glob("*.ts");

for await (const file of glob.scan(".")) {
  console.log(file); // => "index.ts"
}
```

**Match a string against a glob pattern**:

```ts
import { Glob } from "bun";

const glob = new Glob("*.ts");

glob.match("index.ts"); // => true
glob.match("index.js"); // => false
```

`Glob` is a class which implements the following interface:

```ts
class Glob {
  scan(root: string | ScanOptions): AsyncIterable<string>;
  scanSync(root: string | ScanOptions): Iterable<string>;

  match(path: string): boolean;
}

interface ScanOptions {
  /**
   * The root directory to start matching from. Defaults to `process.cwd()`
   */
  cwd?: string;

  /**
   * Allow patterns to match entries that begin with a period (`.`).
   *
   * @default false
   */
  dot?: boolean;

  /**
   * Return the absolute path for entries.
   *
   * @default false
   */
  absolute?: boolean;

  /**
   * Indicates whether to traverse descendants of symbolic link directories.
   *
   * @default false
   */
  followSymlinks?: boolean;

  /**
   * Throw an error when symbolic link is broken
   *
   * @default false
   */
  throwErrorOnBrokenSymlink?: boolean;

  /**
   * Return only files.
   *
   * @default true
   */
  onlyFiles?: boolean;
}
```

## Supported Glob Patterns

Bun supports the following glob patterns:

### `*` - Match any number of characters except `/`

```ts
const glob = new Glob("*.ts");
glob.match("index.ts"); // => true
glob.match("src/index.ts"); // => false
```

### `**` - Match any number of characters including `/`

```ts
const glob = new Glob("**/*.ts");
glob.match("index.ts"); // => true
glob.match("src/index.ts"); // => true
glob.match("src/index.js"); // => false
```

### `{a,b,c}` - Match any of the given patterns

```ts
const glob = new Glob("{a,b,c}.ts");
glob.match("a.ts"); // => true
glob.match("b.ts"); // => true
glob.match("c.ts"); // => true
glob.match("d.ts"); // => false
```
