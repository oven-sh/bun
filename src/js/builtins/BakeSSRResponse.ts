export function wrapComponent(component, responseObject, responseOptions, kind) {
  const bakeGetAsyncLocalStorage = $newZigFunction("bun.js/webcore/Response.zig", "bakeGetAsyncLocalStorage", 0);

  return function () {
    // For Response.redirect(), we need to throw a RedirectAbortError
    if (kind === 1 /* JSBakeResponseKind.Redirect */) {
      // responseObject is the Response from Response.redirect()
      const RedirectAbortError = globalThis.RedirectAbortError;
      if (RedirectAbortError) {
        throw new RedirectAbortError(responseObject);
      }
      // Fallback if RedirectAbortError is not available
      throw new Error("RedirectAbortError not available this is a bug");
    }

    // For Response.render(), we need to throw a RenderAbortError
    if (kind === 2 /* JSBakeResponseKind.Render */) {
      // strongComponent is the path string, responseOptions is params, responseObject is the Response
      // We need to get the RenderAbortError from the global
      const RenderAbortError = globalThis.RenderAbortError;
      if (RenderAbortError) {
        throw new RenderAbortError(component, responseOptions, responseObject);
      }
      // Fallback if RenderAbortError is not available
      throw new Error("RenderAbortError not available this is a bug");
    }

    // For new Response(<jsx />, {}), update AsyncLocalStorage
    const async_local_storage = bakeGetAsyncLocalStorage();
    if (async_local_storage) {
      const store = async_local_storage.getStore();
      if (store) {
        store.responseOptions = responseOptions;
      }
    }
    return component;
  };
}
