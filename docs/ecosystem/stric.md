[Stric](https://github.com/bunsvr) is a Bun framework for building high-preformance web applications and APIs.

```ts#index.ts
import { Router, macro } from '@stricjs/router';

// Export the fetch handler and serve with Bun
export default new Router()
  // Return 'Hi' on every request
  .get('/', macro(() => new Response('Hi')));
```

### Features
- **Fast**: Stric is one of the fastest Bun frameworks. See [benchmark](https://github.com/bunsvr/benchmark) for more details.
- **Minimal**: The basic components like `@stricjs/router` and `@stricjs/utils` is under 50kB and require no external dependencies.
- **Extensible**: Stric comes with a plugin system, dependencies injection and optional optimizations for handling requests.

For more info, see Stric's [documentation](https://stricjs.gitbook.io/docs).
