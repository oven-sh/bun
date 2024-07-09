---
name: Debugging
---

Bun speaks the [WebKit Inspector Protocol](https://github.com/oven-sh/bun/blob/main/packages/bun-types/jsc.d.ts), so you can debug your code with an interactive debugger. For demonstration purposes, consider the following simple web server.

## Debugging JavaScript and TypeScript

```ts#server.ts
Bun.serve({
  fetch(req){
    console.log(req.url);
    return new Response("Hello, world!");
  }
})
```

### `--inspect`

To enable debugging when running code with Bun, use the `--inspect` flag. This automatically starts a WebSocket server on an available port that can be used to introspect the running Bun process.

```sh
$ bun --inspect server.ts
------------------ Bun Inspector ------------------
Listening at:
  ws://localhost:6499/0tqxs9exrgrm

Inspect in browser:
  https://debug.bun.sh/#localhost:6499/0tqxs9exrgrm
------------------ Bun Inspector ------------------
```

### `--inspect-brk`

The `--inspect-brk` flag behaves identically to `--inspect`, except it automatically injects a breakpoint at the first line of the executed script. This is useful for debugging scripts that run quickly and exit immediately.

### `--inspect-wait`

The `--inspect-wait` flag behaves identically to `--inspect`, except the code will not execute until a debugger has attached to the running process.

### Setting a port or URL for the debugger

Regardless of which flag you use, you can optionally specify a port number, URL prefix, or both.

```sh
$ bun --inspect=4000 server.ts
$ bun --inspect=localhost:4000 server.ts
$ bun --inspect=localhost:4000/prefix server.ts
```

## Debuggers

Various debugging tools can connect to this server to provide an interactive debugging experience.

### `debug.bun.sh`

Bun hosts a web-based debugger at [debug.bun.sh](https://debug.bun.sh). It is a modified version of WebKit's [Web Inspector Interface](https://webkit.org/web-inspector/web-inspector-interface/), which will look familiar to Safari users.

Open the provided `debug.bun.sh` URL in your browser to start a debugging session. From this interface, you'll be able to view the source code of the running file, view and set breakpoints, and execute code with the built-in console.

{% image src="https://github.com/oven-sh/bun/assets/3084745/e6a976a8-80cc-4394-8925-539025cc025d" alt="Screenshot of Bun debugger, Console tab" /%}

Let's set a breakpoint. Navigate to the Sources tab; you should see the code from earlier. Click on the line number `3` to set a breakpoint on our `console.log(req.url)` statement.

{% image src="https://github.com/oven-sh/bun/assets/3084745/3b69c7e9-25ff-4f9d-acc4-caa736862935" alt="screenshot of Bun debugger" /%}

Then visit [`http://localhost:3000`](http://localhost:3000) in your web browser. This will send an HTTP request to our `localhost` web server. It will seem like the page isn't loading. Why? Because the program has paused execution at the breakpoint we set earlier.

Note how the UI has changed.

{% image src="https://github.com/oven-sh/bun/assets/3084745/8b565e58-5445-4061-9bc4-f41090dfe769" alt="screenshot of Bun debugger" /%}

At this point there's a lot we can do to introspect the current execution environment. We can use the console at the bottom to run arbitrary code in the context of the program, with full access to the variables in scope at our breakpoint.

{% image src="https://github.com/oven-sh/bun/assets/3084745/f4312b76-48ba-4a7d-b3b6-6205968ac681" /%}

On the right side of the Sources pane, we can see all local variables currently in scope, and drill down to see their properties and methods. Here, we're inspecting the `req` variable.

{% image src="https://github.com/oven-sh/bun/assets/3084745/63d7f843-5180-489c-aa94-87c486e68646" /%}

In the upper left of the Sources pane, we can control the execution of the program.

{% image src="https://github.com/oven-sh/bun/assets/3084745/41b76deb-7371-4461-9d5d-81b5a6d2f7a4" /%}

Here's a cheat sheet explaining the functions of the control flow buttons.

- _Continue script execution_ — continue running the program until the next breakpoint or exception.
- _Step over_ — The program will continue to the next line.
- _Step into_ — If the current statement contains a function call, the debugger will "step into" the called function.
- _Step out_ — If the current statement is a function call, the debugger will finish executing the call, then "step out" of the function to the location where it was called.

{% image src="https://github-production-user-asset-6210df.s3.amazonaws.com/3084745/261510346-6a94441c-75d3-413a-99a7-efa62365f83d.png" /%}

### Visual Studio Code Debugger

Experimental support for debugging Bun scripts is available in Visual Studio Code. To use it, you'll need to install the [Bun VSCode extension](https://bun.sh/guides/runtime/vscode-debugger).

## Debugging Network Requests

The `BUN_CONFIG_VERBOSE_FETCH` environment variable lets you log network requests made with `fetch()` or `node:http` automatically.

| Value   | Description                        |
| ------- | ---------------------------------- |
| `curl`  | Print requests as `curl` commands. |
| `true`  | Print request & response info      |
| `false` | Don't print anything. Default      |

### Print fetch & node:http requests as curl commands

Bun also supports printing `fetch()` and `node:http` network requests as `curl` commands by setting the environment variable `BUN_CONFIG_VERBOSE_FETCH` to `curl`.

```ts
process.env.BUN_CONFIG_VERBOSE_FETCH = "curl";

await fetch("https://example.com", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ foo: "bar" }),
});
```

This prints the `fetch` request as a single-line `curl` command to let you copy-paste into your terminal to replicate the request.

```sh
[fetch] $ curl --http1.1 "https://example.com/" -X POST -H "content-type: application/json" -H "Connection: keep-alive" -H "User-Agent: Bun/1.1.14" -H "Accept: */*" -H "Host: example.com" -H "Accept-Encoding: gzip, deflate, br" --compressed -H "Content-Length: 13" --data-raw "{\"foo\":\"bar\"}"
[fetch] > HTTP/1.1 POST https://example.com/
[fetch] > content-type: application/json
[fetch] > Connection: keep-alive
[fetch] > User-Agent: Bun/1.1.14
[fetch] > Accept: */*
[fetch] > Host: example.com
[fetch] > Accept-Encoding: gzip, deflate, br
[fetch] > Content-Length: 13

[fetch] < 200 OK
[fetch] < Accept-Ranges: bytes
[fetch] < Cache-Control: max-age=604800
[fetch] < Content-Type: text/html; charset=UTF-8
[fetch] < Date: Tue, 18 Jun 2024 05:12:07 GMT
[fetch] < Etag: "3147526947"
[fetch] < Expires: Tue, 25 Jun 2024 05:12:07 GMT
[fetch] < Last-Modified: Thu, 17 Oct 2019 07:18:26 GMT
[fetch] < Server: EOS (vny/044F)
[fetch] < Content-Length: 1256
```

The lines with `[fetch] >` are the request from your local code, and the lines with `[fetch] <` are the response from the remote server.

The `BUN_CONFIG_VERBOSE_FETCH` environment variable is supported in both `fetch()` and `node:http` requests, so it should just work.

To print without the `curl` command, set `BUN_CONFIG_VERBOSE_FETCH` to `true`.

```ts
process.env.BUN_CONFIG_VERBOSE_FETCH = "true";

await fetch("https://example.com", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ foo: "bar" }),
});
```

This prints the following to the console:

```sh
[fetch] > HTTP/1.1 POST https://example.com/
[fetch] > content-type: application/json
[fetch] > Connection: keep-alive
[fetch] > User-Agent: Bun/1.1.14
[fetch] > Accept: */*
[fetch] > Host: example.com
[fetch] > Accept-Encoding: gzip, deflate, br
[fetch] > Content-Length: 13

[fetch] < 200 OK
[fetch] < Accept-Ranges: bytes
[fetch] < Cache-Control: max-age=604800
[fetch] < Content-Type: text/html; charset=UTF-8
[fetch] < Date: Tue, 18 Jun 2024 05:12:07 GMT
[fetch] < Etag: "3147526947"
[fetch] < Expires: Tue, 25 Jun 2024 05:12:07 GMT
[fetch] < Last-Modified: Thu, 17 Oct 2019 07:18:26 GMT
[fetch] < Server: EOS (vny/044F)
[fetch] < Content-Length: 1256
```

## Stacktraces & sourcemaps

Bun transpiles every file, which sounds like it would mean that the stack traces you see in the console would unhelpfully point to the transpiled output. To address this, Bun automatically generates and serves sourcemapped files for every file it transpiles. When you see a stack trace in the console, you can click on the file path and be taken to the original source code, even though it was written in TypeScript or JSX, or has some other transformation applied.

<!-- TODO: uncomment once v1.1.13 regression is fixed (cc @paperdave) -->
<!-- In Bun, each `Error` object gets four additional properties:

- `line` — the source-mapped line number. This number points to the input source code, not the transpiled output.
- `column` — the source-mapped column number. This number points to the input source code, not the transpiled output.
- `originalColumn` — the column number pointing to transpiled source code, without sourcemaps. This number comes from JavaScriptCore.
- `originalLine` — the line number pointing to transpiled source code, without sourcemaps. This number comes from JavaScriptCore.

These properties are populated lazily when `error.stack` is accessed. -->

Bun automatically loads sourcemaps both at runtime when transpiling files on-demand, and when using `bun build` to precompile files ahead of time.

### Syntax-highlighted source code preview

To help with debugging, Bun automatically prints a small source-code preview when an unhandled exception or rejection occurs. You can simulate this behavior by calling `Bun.inspect(error)`:

```ts
// Create an error
const err = new Error("Something went wrong");
console.log(Bun.inspect(err, { colors: true }));
```

This prints a syntax-highlighted preview of the source code where the error occurred, along with the error message and stack trace.

```js
1 | // Create an error
2 | const err = new Error("Something went wrong");
                ^
error: Something went wrong
      at file.js:2:13
```

### V8 Stack Traces

Bun uses JavaScriptCore as it's engine, but much of the Node.js ecosystem & npm expects V8. JavaScript engines differ in `error.stack` formatting. Bun intends to be a drop-in replacement for Node.js, and that means it's our job to make sure that even though the engine is different, the stack traces are as similar as possible.

That's why when you log `error.stack` in Bun, the formatting of `error.stack` is the same as in Node.js's V8 engine. This is especially useful when you're using libraries that expect V8 stack traces.

#### V8 Stack Trace API

Bun implements the [V8 Stack Trace API](https://v8.dev/docs/stack-trace-api), which is a set of functions that allow you to manipulate stack traces.

##### Error.prepareStackTrace

The `Error.prepareStackTrace` function is a global function that lets you customize the stack trace output. This function is called with the error object and an array of `CallSite` objects and lets you return a custom stack trace.

```ts
Error.prepareStackTrace = (err, stack) => {
  return stack.map(callSite => {
    return callSite.getFileName();
  });
};

const err = new Error("Something went wrong");
console.log(err.stack);
// [ "error.js" ]
```

The `CallSite` object has the following methods:

| Method                     | Returns                                               |
| -------------------------- | ----------------------------------------------------- |
| `getThis`                  | `this` value of the function call                     |
| `getTypeName`              | typeof `this`                                         |
| `getFunction`              | function object                                       |
| `getFunctionName`          | function name as a string                             |
| `getMethodName`            | method name as a string                               |
| `getFileName`              | file name or URL                                      |
| `getLineNumber`            | line number                                           |
| `getColumnNumber`          | column number                                         |
| `getEvalOrigin`            | `undefined`                                           |
| `getScriptNameOrSourceURL` | source URL                                            |
| `isToplevel`               | returns `true` if the function is in the global scope |
| `isEval`                   | returns `true` if the function is an `eval` call      |
| `isNative`                 | returns `true` if the function is native              |
| `isConstructor`            | returns `true` if the function is a constructor       |
| `isAsync`                  | returns `true` if the function is `async`             |
| `isPromiseAll`             | Not implemented yet.                                  |
| `getPromiseIndex`          | Not implemented yet.                                  |
| `toString`                 | returns a string representation of the call site      |

In some cases, the `Function` object may have already been garbage collected, so some of these methods may return `undefined`.

##### Error.captureStackTrace(error, startFn)

The `Error.captureStackTrace` function lets you capture a stack trace at a specific point in your code, rather than at the point where the error was thrown.

This can be helpful when you have callbacks or asynchronous code that makes it difficult to determine where an error originated. The 2nd argument to `Error.captureStackTrace` is the function where you want the stack trace to start.

For example, the below code will make `err.stack` point to the code calling `fn()`, even though the error was thrown at `myInner`.

```ts
const fn = () => {
  function myInner() {
    throw err;
  }

  try {
    myInner();
  } catch (err) {
    console.log(err.stack);
    console.log("");
    console.log("-- captureStackTrace --");
    console.log("");
    Error.captureStackTrace(err, fn);
    console.log(err.stack);
  }
};

fn();
```

This logs the following:

```sh
Error: here!
    at myInner (file.js:4:15)
    at fn (file.js:8:5)
    at module code (file.js:17:1)
    at moduleEvaluation (native)
    at moduleEvaluation (native)
    at <anonymous> (native)

-- captureStackTrace --

Error: here!
    at module code (file.js:17:1)
    at moduleEvaluation (native)
    at moduleEvaluation (native)
    at <anonymous> (native)
```
