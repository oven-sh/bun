{% callout type="warning" %}
**Work in Progress** — Bun's HMR API is currently in early development stages. Not everything in `import.meta.hot` is implemented yet.
{% /callout %}

Hot Module Replacement (HMR) allows you to update modules in a running application without needing a full page reload. This preserves the application state and improves the development experience.

HMR is enabled by default when using Bun's full-stack development server.

<!-- Bun's bundler includes a client-side HMR implementation modeled after [Vite's `import.meta.hot` API](https://vitejs.dev/guide/api-hmr.html), making it familiar to developers who have used Vite or similar bundlers. The `import.meta.hot` API described in this document is currently only supported for frontend hot reloading, but we plan to extend it to support server-side hot reloading in future releases. -->

## `import.meta.hot` API Reference

### Compatibility Table

|     | Method             | Notes                                                                 |
| --- | ------------------ | --------------------------------------------------------------------- |
| ✅  | `hot.accept()`     | Indicate that a hot update can be replaced gracefully.                |
| ✅  | `hot.dispose()`    | Add a callback function to run when a module is about to be replaced. |
| ✅  | `hot.data`         | Fully functional; persists data between module evaluations            |
| ❌  | `hot.invalidate()` | Not Implemented                                                       |
| ❌  | `hot.on()`         | Not Implemented                                                       |
| ❌  | `hot.off()`        | Not Implemented                                                       |
| ❌  | `hot.send()`       | Not Implemented                                                       |
| ❌  | `hot.prune()`      | Not Implemented                                                       |
| ✅  | `hot.decline()`    | No-op to match Vite's `import.meta.hot`                               |

### `import.meta.hot.accept()`

### `import.meta.hot.dispose()`

### `import.meta.hot.data`
