[Stric](https://github.com/bunsvr) is a minimalist, fast web framework for Bun.

```ts#index.ts
import { Router } from '@stricjs/router';

// Export the fetch handler and serve with Bun
export default new Router()
  // Return 'Hi' on every request
  .get('/', () => new Response('Hi'));
```

Stric provides support for [ArrowJS](https://www.arrow-js.com), a library for building reactive interfaces. 

{% codetabs %}

```ts#src/App.ts
import { html } from '@stricjs/arrow/utils';

// Code inside this function can use web APIs
export function render() {
  // Render a <p> element with text 'Hi'
  html`<p>Hi</p>`;
};

// Set the path to handle
export const path = '/';
```
```ts#index.ts
import { PageRouter } from '@stricjs/arrow';

// Create a page router, build and serve directly
new PageRouter().serve();
```

{% /codetabs %}

For more info, see Stric's [documentation](https://stricjs.gitbook.io/docs).
