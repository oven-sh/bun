---
name: Parse command-line arguments
---

The _argument vector_ is the list of arguments passed to the program when it is run. It is available as `Bun.argv`.

```ts#cli.ts
console.log(Bun.argv);
```

---

Running this file with arguments results in the following:

```sh
$ bun run cli.tsx --flag1 --flag2 value
[ '/path/to/bun', '/path/to/cli.ts', '--flag1', '--flag2', 'value' ]
```

---

To parse `argv` into a more useful format, `util.parseArgs` would be helpful.

Example:

```ts#cli.ts
import { parseArgs } from "util";

const { values, positionals } = parseArgs({
  args: Bun.argv,
  options: {
    flag1: {
      type: 'boolean',
    },
    flag2: {
      type: 'string',
    },
  },
  strict: true,
  allowPositionals: true,
});

console.log(values);
console.log(positionals);
```

then it outputs

```
$ bun run cli.tsx --flag1 --flag2 value
{
  flag1: true,
  flag2: "value",
}
[ "/path/to/bun", "/path/to/cli.ts" ]
```

