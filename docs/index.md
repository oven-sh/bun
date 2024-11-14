Bun is an all-in-one toolkit for JavaScript and TypeScript apps. It ships as a single executable called `bun`.

At its core is the _Bun runtime_, a fast JavaScript runtime designed as a drop-in replacement for Node.js. It's written in Zig and powered by JavaScriptCore under the hood, dramatically reducing startup times and memory usage.

```bash
$ bun run index.tsx  # TS and JSX supported out of the box
```

The `bun` command-line tool also implements a test runner, script runner, and Node.js-compatible package manager, all significantly faster than existing tools and usable in existing Node.js projects with little to no changes necessary.

```bash
$ bun run start                 # run the `start` script
$ bun install <pkg>             # install a package
$ bun build ./index.tsx         # bundle a project for browsers
$ bun test                      # run tests
$ bunx cowsay 'Hello, world!'   # execute a package
```

Get started with one of the quick links below, or read on to learn more about Bun.

{% block className="gap-2 grid grid-flow-row grid-cols-1 md:grid-cols-2" %}
{% arrowbutton href="/docs/installation" text="Install Bun" /%}
{% arrowbutton href="/docs/quickstart" text="Do the quickstart" /%}
{% arrowbutton href="/docs/cli/install" text="Install a package" /%}
{% arrowbutton href="/docs/cli/bun-create" text="Use a project template" /%}
{% arrowbutton href="/docs/bundler" text="Bundle code for production" /%}
{% arrowbutton href="/docs/api/http" text="Build an HTTP server" /%}
{% arrowbutton href="/docs/api/websockets" text="Build a Websocket server" /%}
{% arrowbutton href="/docs/api/file-io" text="Read and write files" /%}
{% arrowbutton href="/docs/api/sqlite" text="Run SQLite queries" /%}
{% arrowbutton href="/docs/cli/test" text="Write and run tests" /%}
{% /block %}

## What is a runtime?

JavaScript (or, more formally, ECMAScript) is just a _specification_ for a programming language. Anyone can write a JavaScript _engine_ that ingests a valid JavaScript program and executes it. The two most popular engines in use today are V8 (developed by Google)
and JavaScriptCore (developed by Apple). Both are open source.

But most JavaScript programs don't run in a vacuum. They need a way to access the outside world to perform useful tasks. This is where _runtimes_ come in. They implement additional APIs that are then made available to the JavaScript programs they execute.

### Browsers

Notably, browsers ship with JavaScript runtimes that implement a set of Web-specific APIs that are exposed via the global `window` object. Any JavaScript code executed by the browser can use these APIs to implement interactive or dynamic behavior in the context of the current webpage.

<!-- JavaScript runtime that exposes  JavaScript engines are designed to run "vanilla" JavaScript programs, but it's often JavaScript _runtimes_ use an engine internally to execute the code and implement additional APIs that are then made available to executed programs.
JavaScript was [initially designed](https://en.wikipedia.org/wiki/JavaScript) as a language to run in web browsers to implement interactivity and dynamic behavior in web pages. Browsers are the first JavaScript runtimes. JavaScript programs that are executed in browsers have access to a set of Web-specific global APIs on the `window` object. -->

### Node.js

Similarly, Node.js is a JavaScript runtime that can be used in non-browser environments, like servers. JavaScript programs executed by Node.js have access to a set of Node.js-specific [globals](https://nodejs.org/api/globals.html) like `Buffer`, `process`, and `__dirname` in addition to built-in modules for performing OS-level tasks like reading/writing files (`node:fs`) and networking (`node:net`, `node:http`). Node.js also implements a CommonJS-based module system and resolution algorithm that pre-dates JavaScript's native module system.

<!-- Bun.js prefers Web API compatibility instead of designing new APIs when possible. Bun.js also implements some Node.js APIs. -->

Bun is designed as a faster, leaner, more modern replacement for Node.js.

<!-- ## Why a new runtime?

Bun is designed as a faster, leaner, more modern replacement for Node.js. Node.js is burdened by ingrained performance issues, backwards compatibility concerns, and slow development velocity—inevitable issues for a project of its age and magnitude. -->

## Design goals

Bun is designed from the ground-up with today's JavaScript ecosystem in mind.

- **Speed**. Bun processes start [4x faster than Node.js](https://twitter.com/jarredsumner/status/1499225725492076544) currently (try it yourself!)
- **TypeScript & JSX support**. You can directly execute `.jsx`, `.ts`, and `.tsx` files; Bun's transpiler converts these to vanilla JavaScript before execution.
- **ESM & CommonJS compatibility**. The world is moving towards ES modules (ESM), but millions of packages on npm still require CommonJS. Bun recommends ES modules, but supports CommonJS.
- **Web-standard APIs**. Bun implements standard Web APIs like `fetch`, `WebSocket`, and `ReadableStream`. Bun is powered by the JavaScriptCore engine, which is developed by Apple for Safari, so some APIs like [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) and [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) directly use [Safari's implementation](https://github.com/oven-sh/bun/blob/HEAD/src/bun.js/bindings/webcore/JSFetchHeaders.cpp).
- **Node.js compatibility**. In addition to supporting Node-style module resolution, Bun aims for full compatibility with built-in Node.js globals (`process`, `Buffer`) and modules (`path`, `fs`, `http`, etc.) _This is an ongoing effort that is not complete._ Refer to the [compatibility page](https://bun.sh/docs/runtime/nodejs-apis) for the current status.

Bun is more than a runtime. The long-term goal is to be a cohesive, infrastructural toolkit for building apps with JavaScript/TypeScript, including a package manager, transpiler, bundler, script runner, test runner, and more.

<!-- - tsconfig.json `"paths"` is natively supported, along with `"exports"` in package.json
- `fs`, `path`, and `process` from Node.js are partially implemented
- Web APIs like [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch), [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response), [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) and more are built-in
- [`HTMLRewriter`](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) makes it easy to transform HTML in Bun.js
- `.env` files automatically load into `process.env` and `Bun.env`
- top level await -->
