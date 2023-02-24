Many web APIs aren't relevant in the context of a server-first runtime like Bun, such as the [DOM API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API#html_dom_api_interfaces), [`localStorage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage), and [`History`](https://developer.mozilla.org/en-US/docs/Web/API/History_API). Many others, though, are broadly useful outside of the browser context; when possible, Bun implements these Web-standard APIs instead of introducing new APIs.

The following Web APIs are partially or completely supported.

## Globals

{% table %}

---

- Crypto
- [`crypto`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto) [`SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)
  [`CryptoKey`](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey)

---

- Debugging

- [`console`](https://developer.mozilla.org/en-US/docs/Web/API/console)[`performance`](https://developer.mozilla.org/en-US/docs/Web/API/Performance)

---

- Encoding and decoding
- [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/atob) [`btoa`](https://developer.mozilla.org/en-US/docs/Web/API/btoa) [`TextEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder) [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder)

---

- Timeouts
- [`setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout) [`clearTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout)

---

- Intervals
- [`setInterval`](https://developer.mozilla.org/en-US/docs/Web/API/setInterval)[`clearInterval`](https://developer.mozilla.org/en-US/docs/Web/API/clearInterval)

---

- HTTP
- [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch) [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response) [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers) [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController) [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)

---

- Microtasks
- [`queueMicrotask`](https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask)

---

- Errors
- [`reportError`](https://developer.mozilla.org/en-US/docs/Web/API/reportError) [`ResolveError`](https://developer.mozilla.org/en-US/docs/Web/API/ResolveError)
  [`BuildError`](https://developer.mozilla.org/en-US/docs/Web/API/BuildError)

---

- User interaction
- [`alert`](https://developer.mozilla.org/en-US/docs/Web/API/Window/alert) [`confirm`](https://developer.mozilla.org/en-US/docs/Web/API/Window/confirm) [`prompt`](https://developer.mozilla.org/en-US/docs/Web/API/Window/prompt)

<!-- - Blocking. Prints the alert message to terminal and awaits `[ENTER]` before proceeding. -->
<!-- - Blocking. Prints confirmation message and awaits `[y/N]` input from user. Returns `true` if user entered `y` or `Y`, `false` otherwise.
- Blocking. Prints prompt message and awaits user input. Returns the user input as a string. -->

- Blob
- [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)

---

- Realms
- [`ShadowRealm`](https://github.com/tc39/proposal-shadowrealm)

---

- Events
- [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget)
  [`Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event) [`ErrorEvent`](https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent) [`CloseEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent) [`MessageEvent`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent)

---

- WebSockets
- [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

---

- URLs
- [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL) [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)

---

- Streams
- [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream) [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream) [`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream) [`ByteLengthQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/ByteLengthQueuingStrategy) [`CountQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/CountQueuingStrategy) plus associated `*Reader`, `*Writer`, and `*Controller` classes.

<!-- ## Globals

{% table %}

---

---

- [`console`](https://developer.mozilla.org/en-US/docs/Web/API/console)

---

- [`crypto`](https://developer.mozilla.org/en-US/docs/Web/API/Crypto)

---

- [`performance`](https://developer.mozilla.org/en-US/docs/Web/API/Performance)

{% /table %}

## Functions

{% table %}

- [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/atob)

---

- [`btoa`](https://developer.mozilla.org/en-US/docs/Web/API/btoa)

---

- [`clearInterval`](https://developer.mozilla.org/en-US/docs/Web/API/clearInterval)

---

- [`clearTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/clearTimeout)

---

- [`fetch`](https://developer.mozilla.org/en-US/docs/Web/API/fetch)

---

- [`queueMicrotask`](https://developer.mozilla.org/en-US/docs/Web/API/queueMicrotask)

---

- [`reportError`](https://developer.mozilla.org/en-US/docs/Web/API/reportError)

---

- [`setInterval`](https://developer.mozilla.org/en-US/docs/Web/API/setInterval)

---

- [`setTimeout`](https://developer.mozilla.org/en-US/docs/Web/API/setTimeout)

---

- [`alert`](https://developer.mozilla.org/en-US/docs/Web/API/alert)
- Blocking. Prints the alert message to terminal and awaits `[ENTER]` before proceeding.

---

- [`confirm`](https://developer.mozilla.org/en-US/docs/Web/API/confirm)
- Blocking. Prints confirmation message and awaits `[y/N]` input from user. Returns `true` if user entered `y` or `Y`, `false` otherwise.

---

- [`prompt`](https://developer.mozilla.org/en-US/docs/Web/API/prompt)
- Blocking. Prints prompt message and awaits user input. Returns the user input as a string.

---

- [`console`](https://developer.mozilla.org/en-US/docs/Web/API/console)

{% /table %}

## Classes

{% table %}

---

- [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob)

---

- [`Response`](https://developer.mozilla.org/en-US/docs/Web/API/Response)

---

- [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request)

---

- [`TextEncoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder) and [`TextDecoder`](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder)

---

---

- [`ShadowRealm`](https://github.com/tc39/proposal-shadowrealm)
- A ["better `eval`](https://2ality.com/2022/04/shadow-realms.html). Currently a Stage 3 TC39 proposal

---

- [`Headers`](https://developer.mozilla.org/en-US/docs/Web/API/Headers)

---

- [`EventTarget`](https://developer.mozilla.org/en-US/docs/Web/API/EventTarget)

---

- [`Event`](https://developer.mozilla.org/en-US/docs/Web/API/Event)

---

- [`ErrorEvent`](https://developer.mozilla.org/en-US/docs/Web/API/ErrorEvent)

---

- [`CloseEvent`](https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent)

---

- [`MessageEvent`](https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent)

---

- [`WebSocket`](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

---

- [`URLSearchParams`](https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams)

---

- [`URL`](https://developer.mozilla.org/en-US/docs/Web/API/URL)

---

- [`AbortController`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController)

---

- [`Loader`](https://developer.mozilla.org/en-US/docs/Web/API/Loader)

---

- [`ReadableStream`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream)

---

- [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)

---

- [`ByteLengthQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/ByteLengthQueuingStrategy)

---

- [`ReadableStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultController)

---

- [`ReadableStreamDefaultReader`](https://developer.mozilla.org/en-US/docs/Web/API/ReadableStreamDefaultReader)

---

- [`WritableStream`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStream)

---

- [`WritableStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultController)

---

- [`WritableStreamDefaultWriter`](https://developer.mozilla.org/en-US/docs/Web/API/WritableStreamDefaultWriter)

---

- [`TransformStream`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStream)

---

- [`TransformStreamDefaultController`](https://developer.mozilla.org/en-US/docs/Web/API/TransformStreamDefaultController)

---

- [`CountQueuingStrategy`](https://developer.mozilla.org/en-US/docs/Web/API/CountQueuingStrategy)

---

- [`SubtleCrypto`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto)

---

- [`CryptoKey`](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey)

---

- [`ResolveError`](https://developer.mozilla.org/en-US/docs/Web/API/ResolveError)

---

- [`BuildError`](https://developer.mozilla.org/en-US/docs/Web/API/BuildError)

{% /table %} -->
