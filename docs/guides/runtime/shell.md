---
name: Run a Shell Command
---

Bun Shell is a cross-platform bash-like shell built in to Bun.

It provides a simple way to run shell commands in JavaScript and TypeScript. To get started, import the `$` function from the `bun` package and use it to run shell commands.

```ts#foo.ts
import { $ } from "bun";

await $`echo Hello, world!`; // => "Hello, world!"
```

---

The `$` function is a tagged template literal that runs the command and returns a promise that resolves with the command's output.

```ts#foo.ts
import { $ } from "bun";

const output = await $`ls -l`.text();
console.log(output);
```

---

To get each line of the output as an array, use the `lines` method.

```ts#foo.ts
import { $ } from "bun";

for await (const line of $`ls -l`.lines()) {
  console.log(line);
}
```

---

See [Docs > API > Shell](/api/shell) for complete documentation.
