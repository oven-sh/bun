### Not implemented yet

bun is a project with an incredibly large scope and is still in its early days.

You can see [Bun's Roadmap](https://github.com/Jarred-Sumner/bun/issues/159), but here are some additional things that are planned:

| Feature                                                                               | In             |
| ------------------------------------------------------------------------------------- | -------------- |
| Web Streams with Fetch API                                                            | bun.js         |
| Web Streams with HTMLRewriter                                                         | bun.js         |
| WebSocket Server                                                                      | bun.js         |
| Package hoisting that matches npm behavior                                            | bun install    |
| Source Maps (unbundled is supported)                                                  | JS Bundler     |
| Source Maps                                                                           | CSS            |
| JavaScript Minifier                                                                   | JS Transpiler  |
| CSS Minifier                                                                          | CSS            |
| CSS Parser (it only bundles)                                                          | CSS            |
| Tree-shaking                                                                          | JavaScript     |
| Tree-shaking                                                                          | CSS            |
| [`extends`](https://www.typescriptlang.org/tsconfig#extends) in tsconfig.json         | TS Transpiler  |
| [TypeScript Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html) | TS Transpiler  |
| `@jsxPragma` comments                                                                 | JS Transpiler  |
| Sharing `.bun` files                                                                  | bun            |
| Dates & timestamps                                                                    | TOML parser    |
| [Hash components for Fast Refresh](https://github.com/Jarred-Sumner/bun/issues/18)    | JSX Transpiler |

<small>
JS Transpiler == JavaScript Transpiler
<br/>
TS Transpiler == TypeScript Transpiler
<br/>
Package manager == `bun install`
<br/>
bun.js == bun’s JavaScriptCore integration that executes JavaScript. Similar to how Node.js & Deno embed V8.
</small>

### Limitations & intended usage

Today, bun is mostly focused on bun.js: the JavaScript runtime.

While you could use bun's bundler & transpiler separately to build for browsers or node, bun doesn't have a minifier or support tree-shaking yet. For production browser builds, you probably should use a tool like esbuild or swc.

Longer-term, bun intends to replace Node.js, Webpack, Babel, yarn, and PostCSS (in production).

### Upcoming breaking changes

- Bun's CLI flags will change to better support bun as a JavaScript runtime. They were chosen when bun was just a frontend development tool.
- Bun's bundling format will change to accommodate production browser bundles and on-demand production bundling
