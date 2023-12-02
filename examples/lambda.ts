const { AWS_LAMBDA_RUNTIME_API, LAMBDA_TASK_ROOT, _HANDLER } = process.env;

if (!AWS_LAMBDA_RUNTIME_API || AWS_LAMBDA_RUNTIME_API === "") {
  throw new Error("AWS_LAMBDA_RUNTIME_API is not set");
}

const nextURL = `http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/next`;
const sourceDir = LAMBDA_TASK_ROOT;
if (!sourceDir) {
  throw new Error("handler is not set");
}
if (!_HANDLER) {
  throw new Error("handler is not set");
}

// don't care if this fails
if (process.cwd() !== sourceDir) {
  try {
    process.chdir(sourceDir);
  } catch (e) {}
}

var handlerDot = _HANDLER.lastIndexOf(".");
var sourcefile = handlerDot > 0 ? _HANDLER.substring(0, handlerDot) : _HANDLER;
if (sourcefile.length === 0) {
  throw new Error("handler is not set");
}
if (!sourcefile.startsWith("/")) {
  sourcefile = `./${sourcefile}`;
}
function noop() {}
const method = (handlerDot > 0 ? _HANDLER.substring(handlerDot) : "") || "GET";

if (typeof process.env.VERBOSE !== "undefined") {
  console.time(`Loaded ${sourcefile}`);
}
var Handler;

try {
  Handler = await import(sourcefile);
} catch (e: any) {
  console.error("Error loading sourcefile:", e);
  try {
    await fetch(new URL(`http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/init/error`).href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        errorMessage: e.message,
        errorType: e.name,
        stackTrace: e?.stack?.split("\n") ?? [],
      }),
    });
  } catch (e2) {
    console.error("Error sending error to runtime:", e2);
  }
  process.exit(1);
}

if (typeof process.env.VERBOSE !== "undefined") {
  console.timeEnd(`Loaded ${sourcefile}`);
}

const handlerFunction = Handler.default?.fetch;
if (typeof handlerFunction !== "function") {
  const e = new Error(`${sourcefile} must export default a function called fetch

Here is an example:

export default {
    fetch(req) {
        return new Response("Hello World");
    }
}
`);

  console.error(e);

  try {
    await fetch(new URL(`http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/init/error`).href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        errorMessage: e.message,
        errorType: e.name,
        stackTrace: e?.stack?.split("\n") ?? [],
      }),
    });
  } catch (e2) {
    console.error("Error sending error to runtime:", e2);
  }

  process.exit(1);
}

var baseURLString = AWS_LAMBDA_RUNTIME_API;
if ("baseURI" in Handler.default) {
  baseURLString = Handler.default.baseURI?.toString();
}

var baseURL;
try {
  baseURL = new URL(baseURLString);
} catch (e: any) {
  console.error("Error parsing baseURI:", e);
  try {
    await fetch(new URL(`http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/init/error`).href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        errorMessage: e.message,
        errorType: e.name,
        stackTrace: e?.stack?.split("\n") || [],
      }),
    });
  } catch (e2) {
    console.error("Error sending error to runtime:", e2);
  }

  process.exit(1);
}

async function runHandler(response: Response) {
  const traceID = response.headers.get("Lambda-Runtime-Trace-Id");
  const requestID = response.headers.get("Lambda-Runtime-Aws-Request-Id");
  var request = new Request(baseURL.href, {
    method,
    headers: response.headers,
    body: parseInt(response.headers.get("Content-Length") || "0", 10) > 0 ? await response.blob() : undefined,
  });
  // we are done with the Response object here
  // allow it to be GC'd
  (response as any) = undefined;

  var result: Response;
  try {
    if (typeof process.env.VERBOSE !== "undefined") {
      console.time(`[${traceID}] Run ${request.url}`);
    }
    result = handlerFunction(request, {});
    if (result && (result as any).then) {
      await result;
    }
  } catch (e1: any) {
    if (typeof process.env.VERBOSE !== "undefined") {
      console.error(`[${traceID}] Error running handler:`, e1);
    }
    fetch(`http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/${requestID}/error`, {
      method: "POST",

      body: JSON.stringify({
        errorMessage: e1.message,
        errorType: e1.name,
        stackTrace: e1?.stack?.split("\n") ?? [],
      }),
    }).finally(noop);
    return;
  } finally {
    if (typeof process.env.VERBOSE !== "undefined") {
      console.timeEnd(`[${traceID}] Run ${request.url}`);
    }
  }

  if (!result || !("headers" in result)) {
    await fetch(`http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/${requestID}/error`, {
      method: "POST",
      body: JSON.stringify({
        errorMessage: "Expected Response object",
        errorType: "ExpectedResponseObject",
        stackTrace: [],
      }),
    });
    return;
  }

  await fetch(`http://${AWS_LAMBDA_RUNTIME_API}/2018-06-01/runtime/invocation/${requestID}/response`, {
    method: "POST",
    headers: result.headers,
    body: await result.blob(),
  });
  (result as any) = undefined;
}

while (true) {
  fetch(nextURL).then(runHandler, console.error);
}

export {};
