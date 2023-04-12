Bun is designed to start fast and run fast.

Under the hood Bun uses the [JavaScriptCore engine](https://developer.apple.com/documentation/javascriptcore), which is developed by Apple for Safari. It starts and runs faster than V8, the engine used by Node.js and Chromium-based browsers. It's transpiler and runtime are written in Zig, a modern, high-performance language. On Linux, this translates into startup times [4x faster](https://twitter.com/jarredsumner/status/1499225725492076544) than Node.js.

{% image src="/images/bun-run-speed.jpeg" caption="Bun vs Node.js vs Deno running Hello World" /%}

<!-- If no `node_modules` directory is found in the working directory or above, Bun will abandon Node.js-style module resolution in favor of the `Bun module resolution algorithm`. Under Bun-style module resolution, all packages are _auto-installed_ on the fly into a [global module cache](/docs/cli/install#global-cache). For full details on this algorithm, refer to [Runtime > Modules](/docs/runtime/modules). -->
