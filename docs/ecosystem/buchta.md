[Buchta](https://buchtajs.com) is a Full-Stack framework powered by Bun that takes most features from Bun as its advantages

```ts#server.ts
import { Buchta, BuchtaRequest, BuchtaResponse } from "buchta";

const app = new Buchta();

app.get("/api/hello/", (req: BuchtaRequest, res: BuchtaResponse) => {
    res.send("Hello, World!");
});

app.run();
```

Get started with `bun x buchta init`.

```bash
$ bun x buchta init myapp # configure it to your likings
$ cd myapp
$ bun install
$ bun run buchta serve
```

For more information on how to write your own plugins, how to use FS router, etc. Follow buchta's [documentation](https://buchtajs.com/docs/)