---
name: Get the absolute path to the current entrypoint
---

The `Bun.main` property contains the absolute path to the current entrypoint.

{% codetabs %}

```ts#foo.ts
console.log(Bun.main);
```

```ts#index.ts
import "./foo.ts";
```

{% /codetabs %}

---

The printed path corresponds to the file that is executed with `bun run`.

```sh
$ bun run index.ts
/path/to/index.ts
$ bun run foo.ts
/path/to/foo.ts
```

---

See [Docs > API > Utils](https://bun.sh/docs/api/utils) for more useful utilities.
