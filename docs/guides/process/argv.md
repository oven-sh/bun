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

To parse `argv` into a more useful format, consider using [minimist](https://github.com/minimistjs/minimist) or [commander](https://github.com/tj/commander.js).
