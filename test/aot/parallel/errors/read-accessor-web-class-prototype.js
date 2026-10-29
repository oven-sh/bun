// The accessors of URL, Request, Response and their like are native code without a function object. Read on the prototype itself, which is no instance, each throws, and the stack trace
// begins at the function that reads. A store through one that takes stores does the same. It prints what plain Bun prints.
"use strict";
function framesOf(error) {
  const frames = [];
  for (const text of String(error.stack).split("\n")) {
    const frame = /^\s*at (?:(.*?) \()?([^()]*?)(?::(\d+):(\d+))?\)?$/.exec(text);
    if (!frame) continue;
    const file = frame[2].replace(/^.*[\\/]/, "");
    frames.push((frame[1] ?? "") + "@" + file + (frame[3] && file !== "native" ? ":" + frame[3] + ":" + frame[4] : ""));
  }
  return frames.slice(0, 2).join(" | ");
}
function attempt(label, run) {
  try {
    console.log(label, "->", String(run()));
  } catch (error) {
    console.log(label, "->", error.name, framesOf(error));
  }
}

attempt("URL href", () => URL.prototype.href);
attempt("URL origin", () => URL.prototype.origin);
attempt("URL searchParams", () => URL.prototype.searchParams);
attempt("URL username", () => URL.prototype.username);
attempt("URL href, a store", () => { URL.prototype.href = "http://example.com/"; });
attempt("URLSearchParams size", () => URLSearchParams.prototype.size);
attempt("Request url", () => Request.prototype.url);
attempt("Request headers", () => Request.prototype.headers);
attempt("Request signal", () => Request.prototype.signal);
attempt("Request body", () => Request.prototype.body);
attempt("Response url", () => Response.prototype.url);
attempt("Response headers", () => Response.prototype.headers);
attempt("Response statusText", () => Response.prototype.statusText);
attempt("Response body", () => Response.prototype.body);
attempt("Blob size", () => Blob.prototype.size);
attempt("Blob type", () => Blob.prototype.type);
attempt("TextDecoder encoding", () => TextDecoder.prototype.encoding);
attempt("TextEncoder encoding", () => TextEncoder.prototype.encoding);
attempt("AbortSignal aborted", () => AbortSignal.prototype.aborted);
attempt("Event type", () => Event.prototype.type);

// The reads that answer.
const url = new URL("http://user@example.com:81/a?b=1#c");
attempt("an instance", () => [url.href, url.origin, url.username, url.searchParams.size, new Request(url).url, new Response("", { statusText: "fine" }).statusText, new TextDecoder().encoding].join(" "));
