{% callout type="warning" %}
**Work in Progress** — Bun's HMR API is currently in early development stages. Of the APIs described in this document, only `import.meta.hot.dispose()` and `import.meta.hot.data` are fully implemented. The other methods either log warnings, throw errors, or do nothing. The implementation does perform recursive module re-evaluation (rather than full page reloads), but granular module acceptance boundaries through `import.meta.hot.accept()` are not yet functional. The current implementation is useful for state persistence between reloads, but more sophisticated HMR patterns are still in development.
{% /callout %}

Hot Module Replacement (HMR) allows you to update modules in a running application without needing a full page reload. This preserves the application state and improves the development experience.

Bun's bundler includes a client-side HMR implementation modeled after [Vite's `import.meta.hot` API](https://vitejs.dev/guide/api-hmr.html), making it familiar to developers who have used Vite or similar bundlers. The `import.meta.hot` API described in this document is currently only supported for frontend hot reloading, but we plan to extend it to support server-side hot reloading in future releases.

## Overview

When you use Bun's bundler in development mode, it automatically sets up a WebSocket connection between the browser and the bundler server. When you change a file, Bun:

1. Rebuilds only the changed modules
2. Sends the updated modules to the browser via WebSocket
3. Recursively re-evaluates the module tree from the changed modules
4. Calls `dispose` handlers to clean up resources before module replacement
5. Preserves state via the `hot.data` object between module evaluations

## Usage

There are two ways to get started with `import.meta.hot` in Bun:

### Frontend Hot Reloading

Hot Reloading is enabled by default when you run `bun ./index.html`.

From there, you can use `import.meta.hot.data` to persist state between module evaluations. The `import.meta.hot` object is referentially equal between module evaluations, so you can use it to persist state across module updates.

To disable HMR when using HTML entrypoints, set `NODE_ENV=production` as an environment variable.

### Full-Stack Hot Reloading

Frontend and server-side hot reloading are independent features that can be used together.

To enable frontend hot reloading, pass `development: true` to `Bun.serve()`.

```ts#server.ts
import { serve } from "bun";
import homepage from "./index.html";

serve({
  // Enable frontend hot reloading
  development: true,

  routes: {
    // Setup frontend routes
    "/": homepage,

    // Setup API routes
    "/api/v1/users": {
      async GET() {
        return Response.json([{ id: 1, name: "John Doe" }]);
      },

      async POST(req) {
        const user = await req.json();
        return Response.json({ success: true, user });
      },
    },
  },
});
```

To enable server-side hot reloading, pass `--hot` to the Bun CLI:

```sh
$ bun --hot ./server.ts
```

`--hot` and `development: true` can both be used at the same time.

## API Reference

### Compatibility Table

|     | Method             | Notes                                                                             |
| --- | ------------------ | --------------------------------------------------------------------------------- |
| 🚧  | `hot.accept()`     | API exists but only logs "TODO" warning; accepts no module boundaries             |
| ✅  | `hot.dispose()`    | Fully functional; registers callbacks that are executed before module replacement |
| ✅  | `hot.data`         | Fully functional; persists data between module evaluations                        |
| ❌  | `hot.decline()`    | Exists as empty function for compatibility with Vite APIs                         |
| 🚧  | `hot.invalidate()` | Exists but throws "TODO: implement ImportMetaHot.invalidate" error                |
| 🚧  | `hot.on()`         | Exists but throws "TODO: implement ImportMetaHot.on" error                        |
| 🚧  | `hot.off()`        | Exists but throws "TODO: implement ImportMetaHot.off" error                       |
| 🚧  | `hot.send()`       | Exists but throws "TODO: implement ImportMetaHot.send" error                      |
| 🚧  | `hot.prune()`      | Exists but throws "TODO: implement ImportMetaHot.prune" error                     |

**Currently Functional APIs:**

- `hot.dispose()`: Successfully registers cleanup callbacks that run before module replacement
- `hot.data`: Successfully maintains state between module evaluations

### `hot.accept()`

{% callout %}
❌ **Not implemented** — Currently, `hot.accept()` logs a warning message and does not execute the provided callbacks. The module tree will still be recursively re-evaluated, but without respecting the specified acceptance boundaries.
{% /callout %}

Accepts hot updates for this module or its dependencies.

```ts#hmr-accept.ts
// Accept self (simplest form)
import.meta.hot.accept();
// This logs: "TODO: implement ImportMetaHot.accept" and does nothing

// Accept self with a callback to handle updates
import.meta.hot.accept(newModule => {
  // This callback will not be called in the current implementation
  console.log("Updated module received", newModule);
});

// Accept updates to specific dependencies
import.meta.hot.accept(["./dep1.js", "./dep2.js"], ([dep1, dep2]) => {
  // This callback will not be called in the current implementation
  console.log("Dependencies updated");
});
```

In future releases, when a module is accepted, Bun will properly respect the acceptance boundaries, preventing propagation of updates beyond accepted modules and executing the provided callbacks. This will enable more granular control over how module updates are handled.

### `hot.dispose()`

{% callout type="success" %}
✅ **Fully implemented** — `hot.dispose()` works as expected, allowing you to register callbacks that will be executed before the module is replaced.
{% /callout %}

Registers a callback that will be called when the module is about to be replaced.

```ts#dispose.ts
import.meta.hot.dispose(data => {
  // Clean up resources or save state
  data.state = {
    /* state to preserve */
  };

  // Teardown side effects
  myEventListener.disconnect();

  // Close connections
  myWebSocket.close();

  // Clear timers
  clearTimeout(myTimer);
});
```

The `data` object is passed to the callback and can be used to store information that will be available via `hot.data` in the next instance of the module. This is particularly useful for preserving state across module updates.

### `hot.data`

{% callout type="success" %}
✅ **Fully implemented** — `hot.data` works as expected, preserving data between module evaluations through the values set in `dispose` callbacks.
{% /callout %}

An object that persists between updates. Contains data from the previous module instance that was passed in the `dispose` handler.

```ts#counter.ts
// Simple counter with hot reload state persistence
let count = 0;

// Restore previous count when hot reloaded
if (import.meta.hot) {
  // Recover previous count from hot.data
  if (import.meta.hot.data.count !== undefined) {
    count = import.meta.hot.data.count;
  }

  // Save state before module is replaced
  import.meta.hot.dispose(data => {
    data.count = count;
  });

  import.meta.hot.accept();
}

export function increment() {
  return ++count;
}
```

Without this pattern, the counter would reset to 0 each time the module is hot-reloaded. With `hot.data`, the counter's value persists across updates.

This is one of the fully implemented features of Bun's HMR system, allowing you to maintain state even as modules are replaced.

### `hot.decline()`

{% callout %}
⚠️ **Not implemented** — This method is a no-op in Bun's implementation (for compatibility with Vite).
{% /callout %}

Indicates that this module cannot be hot updated. This method is included for API compatibility but doesn't have any effect in Bun's implementation.

```ts#decline.ts
// This won't have any effect in Bun's implementation
import.meta.hot.decline();
```

### `hot.invalidate()`

{% callout %}
❌ **Not implemented** — Currently, `hot.invalidate()` throws an error: "TODO: implement ImportMetaHot.invalidate"
{% /callout %}

Forces a full page reload.

```ts#invalidate.ts
if (cannotUpdate) {
  // This will throw an error in the current implementation:
  // "Error: TODO: implement ImportMetaHot.invalidate"
  import.meta.hot.invalidate();
}
```

### `hot.on()` & `hot.off()`

{% callout %}
❌ **Not implemented** — These methods throw an error: "TODO: implement ImportMetaHot.on/off"
{% /callout %}

Register and unregister event listeners. These methods exist for API compatibility but throw errors in the current implementation.

```ts#event-listeners.ts
try {
  // This will throw an error: "Error: TODO: implement ImportMetaHot.on"
  import.meta.hot.on("custom-event", data => {
    console.log("Custom event received", data);
  });

  // This will throw an error: "Error: TODO: implement ImportMetaHot.off"
  import.meta.hot.off("custom-event", listener);
} catch (err) {
  console.error(err);
}
```

### `hot.send()`

{% callout %}
❌ **Not implemented** — This method throws an error: "TODO: implement ImportMetaHot.send"
{% /callout %}

Send custom events to the dev server. This method exists for API compatibility but throws an error in the current implementation.

```ts#send-event.ts
try {
  // This will throw an error: "Error: TODO: implement ImportMetaHot.send"
  import.meta.hot.send("client-event", { data: "example" });
} catch (err) {
  console.error(err);
}
```

## Hot Reloading CSS

CSS files are automatically hot-reloaded in the browser without a page refresh, providing immediate visual feedback during development. This includes:

- `@import`ed CSS files
- CSS files imported from JavaScript using `import` statements
- CSS files bundled with your application
- `<link rel="stylesheet">` tags in HTML entry points

## React Fast Refresh

Bun's bundler includes built-in support for React Fast Refresh, a feature that updates React components in-place without losing their state. This creates a seamless development experience where UI changes are immediately visible while preserving user interactions.

There's no dependency to install to enable React Fast Refresh support in Bun. The transpiler transform automatically enabled when using React components (so long as a jsxImportSource points to React and there're file(s) using React)
