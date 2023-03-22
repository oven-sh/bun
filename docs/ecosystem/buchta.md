[Buchta](https://buchtajs.com) is a fullstack framework designed to take full advantage of Bun's strengths. It currently supports Preact and Svelte.

To get started:

```bash
$ bunx buchta init myapp
Project templates: 
- svelte
- default
- preact
Name of template: preact  
Do you want TSX? y  
Do you want SSR? y
Enable livereload? y
Buchta Preact project was setup successfully!
$ cd myapp
$ bun install
$ bunx buchta serve
```

To implement a simple HTTP server with Buchta:

```ts#server.ts
import { Buchta, type BuchtaRequest, type BuchtaResponse } from "buchta";

const app = new Buchta();

app.get("/api/hello/", (req: BuchtaRequest, res: BuchtaResponse) => {
  res.send("Hello, World!");
});

app.run();
```


For more information, refer to Buchta's [documentation](https://buchtajs.com/docs/).