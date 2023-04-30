[Stric](https://github.com/bunsvr) is a minimalist, fast web framework for Bun.

```ts#index.ts
import { App } from "@stricjs/core";

export default new App()
  .use(() => new Response("Hi!"));
```

Stric provides support for [ArrowJS](https://www.arrow-js.com), a library for building reactive interfaces in **native** JavaScript. 

{% codetabs %}

```ts#src/App.ts
import { html } from "@stricjs/arrow/utils";

export function render() {
  html`<p>Hi</p>`;
};

export const path = "/";
```
```ts#index.ts
import { PageRouter } from "@stricjs/arrow";

new PageRouter().serve();
```

{% /codetabs %}

For more info, see Stric's [documentation](https://stricjs.gitbook.io/docs).
