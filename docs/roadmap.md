This tracks the current near-term plans for Bun.

Edge bundling
With bundle-time functions, static analysis goes dynamic. Objects returned by functions executed at bundle-time are injected into the AST. This makes dead-code elimination work a lot better.

I expect this to spawn a new generation of bundle-time JavaScript frameworks.

But first, a lot more needs to be built.

Main blockers
JavaScript minifier

Minify JavaScript identifier names
Compress JavaScript syntax (this is partially implemented)
Constant folding
Dead code elimination (this is partially implemented)
Read "sideEffects" from package.json
Web Bundler (production-focused, instead of development-focused)):

Tree-shaking
Source maps
Source maps for JavaScript (exists today without bundling)
Source maps for CSS
Input source maps
Code splitting (esm)
Link-time optimizations
const TypeScript enum support
cross-module inlining for bundle-time known objects
Optional concurrency. In the CI-scenario, it needs to work great in parallel and in the edge runtime scenario, it needs to work great potentially running single-threaded.
Multiple output formats
IIFE (immediately invoked function expressions)
CommonJS
ES Modules
Continue supporting Hot Module Reloading after these changes
CSS parser:

CSS Minifier
CSS Lexer
CSS Parser/AST
CSS Auto-prefixer
Bun.Transpiler support for CSS
Support for parsing css inside of JavaScript

 <style jsx> support
Once complete, the next step is integration with the HTTP server and other Bun APIs

Efficient bundling format
Cache builds into a binary archive format with metadata designed for fast random access, splice(), and sendfile() support. Outside of the edge runtime, these will work as a single-file JavaScript executable internally holding many files.

Instances of Bun will need to know what bundle(s) they're serving. From there, instead of going through a filesystem, we can serve static requests directly from the bundle and dynamic requests will bundle on-demand, potentially importing code from statically-bundled code.

 Bundle API (not finalized yet)

 Bundle.prototype.resolve(path): string API
 Bundle.prototype.build(entryPoint, context): Response API
 Bundle.prototype.generate(entryPoints, options): Promise<Bundle> API
 JSNode AST API

 Receive context/env data from the HTTP server and/or Bundle
 Support generated functions
 Support generated classes
 Support generated objects
 Support injecting imports
Server-side rendering
 Support Next.js (partial support right now)
 Support Remix (partial support right now)
 Support SvelteKit
 Support Nuxt.js
 Support Vite
 Experiment with React-specific optimizations
 Stringify static React elements into raw HTML at bundle-time, handling encoding and escaping correctly
 Support a fast path for generating ETags
 Integrate with Bundle, JSNode, and other Bun APIs
Runtime
 Foreign function interface (FFI) to support loading native code
 Module loader hooks to enable .vue, .svelte, .scss imports and more.
 Implement esbuild's onLoad API in bun.js
 Implement esbuild's onResolve API in bun.js
 Support when building for bun.js
 Support when building for web
 A way to configure which hooks to load before bun starts, likely in bunfig.toml
 onLoad plugins from native libraries
 onResolve plugins from native libraries
 Fastest SQLite client available in JavaScript
 Fastest PostgreSQL client available in JavaScript
 Explore a socket-based implementation
 Explore a libpq-based implementation
 Fastest MySQL client available in JavaScript
 Explore a socket-based implementation
 Explore a libmysqlclient-based implementation
 TCP sockets API with TLS 1.3, likely based on uSockets
 DNS resolution API, probably using c-ares
 Support https: and http: imports. This includes a disk cache possibly integrated into the bundling format.
 Support data: imports
 Support blob: imports & URLs (URL.createObjectURL, URL.revokeObjectURL)
 Reliably unload JavaScript VMs without memory leaks and without restarting bun's process
 Rewrite the JavaScript event loop implementation to be more efficient
Edge Runtime
Slimmer, linux-only build of bun.js:

 Only loads prebundled code
 Design for starting as fast as possible
 No tsconfig.json parsing
 No package.json parsing
 No bunfig.toml parsing
 No node_module resolver
 Use binary bundling format
 Potentially disable NAPI and FFI
 Spawn a new JSGlobalObject per HTTP request and suspend it after response is sent/fully queued
No bun install
No other subcommands
Usability & Developer Experience
 High-quality examples for getting started with bun. Right now, the examples are poor quality.
 bun REPL with transpiler-enabled support for async/await, typescript and ES Modules (those are not supported by eval usually)
 Public docs
 Public landing page
 Public github repo
 bun subcommand for running npm packages or URLs that may not already be installed. Like npx
 GitHub Actions for bun
 @types/bun npm package
Ecosystem
Run Next.js apps in production with bun.js
Run Remix apps in production with bun.js
Run SvelteKit apps in production with bun.js
Use Prisma, Apollo, etc with bun.js
more frameworks
Investigate running Vite inside bun.js
Support running Bun from StackBlitz
Web Compatibility
 Web Streams

 Import implementation from WebKit/Safari into bun.js
 Support in fetch
 Support in Request
 Support in Response
 Support in Blob
 Support in Bun.serve (HTTP server)
 Support in HTMLRewriter
 TextEncoderStream
 TextDecoderStream
 CompressionStream
 Investigate using libdeflate
 DecompressionStream
 Investigate using libdeflate
 Fast path for file descriptors
 Fast path for files (from path)
 Fast path for sockets
 Fast path for pipes
 Fast path for bundled assets
 FormData

 Import implementation from WebKit/Safari into bun.js
 Support in fetch
 Web Worker support

 Import from WebKit/Safari into bun.js
 Import postMessage from WebKit
 Import BroadcastChannel from WebKit
 Import MessageChannel from WebKit
 Import structuredClone from WebKit
 Import WebCrypto implementation from WebKit/Safari into bun.js

 Support OffscreenCanvas API, ImageBitmap for 2D graphics. This may use WebKit's implementation or it might use Skia

note: after a little testing, performance of safari's web streams implementation is similar to deno and much faster than node 18. I expect the final result to be faster than deno because bun's TextEncoder/TextDecoder & Blob implementation seems generally faster than safari's

Security
 Verify TLS certificates in fetch. Right now, it doesn't.
 Investigate supporting Content Security Policy (CSP) in bun.js
This would mean limiting which domains are accessible to the runtime based on the script execution context and how/where code is loaded into the runtime.
If we decide to support this, we likely can use WebKit's implementation for most of it.
Windows support
The HTTP client needs a Windows implementation for the syscalls
Bun needs test coverage for Windows filepath handling
All of bun's dependencies need to compile on Windows
Building JavaScriptCore needs to work on Windows and the JIT tiers need to work. I don't know what the current status of this is. WebKit's bug tracker suggests it may not have JITs enabled which will likely need some patches to fix it.
Node.js Compatibility
 Node-API support
 child_process support
 non-blocking "fs"
 "net" module
 "crypto" polyfill should use hardware-accelerated crypto for better performance
 Finish "buffer" implementation
 require implementation that natively supports ESM (rather than via transpiler). This would involve subclassing AbstractModuleRecord in JSC. This would better support lazy-loading CommonJS modules.
Reliability
Better fetch implementation:
 HTTP Keep-Alive
 TLS 1.3 0-RTT
 HTTP Pipelining
 Cookie Jar
 HTTP/3 (QUIC)
 Run Web Platform tests
 Run Test262
 Support ActiveDOMObject from WebKit so that all native objects can be suspended & terminated
Misc
Package hoisting for bun install
workspace: dependencies
link: dependencies
github: dependencies
