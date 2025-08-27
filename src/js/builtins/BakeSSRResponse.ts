// Used to make a Response fake being a component
// When this is called, it will render the component and then update async local
// storage with the options of the Response
// For Response.render(), we pass the response as strongComponent and need a 4th parameter
// For Response.redirect(), isRenderRedirect will be "redirect" instead of true
export function wrapComponent(strongComponent, responseOptions, isRenderRedirect, responseObject) {
  const bakeGetAsyncLocalStorage = $newZigFunction("bun.js/webcore/Response.zig", "bakeGetAsyncLocalStorage", 0);

  return function () {
    // For Response.redirect(), we need to throw a RedirectAbortError
    if (isRenderRedirect === "redirect") {
      // responseObject is the Response from Response.redirect()
      const RedirectAbortError = globalThis.RedirectAbortError;
      if (RedirectAbortError) {
        throw new RedirectAbortError(responseObject);
      }
      // Fallback if RedirectAbortError is not available
      throw new Error("RedirectAbortError not available this is a bug");
    }

    // For Response.render(), we need to throw a RenderAbortError
    if (isRenderRedirect === true || isRenderRedirect === "render") {
      // strongComponent is the path string, responseOptions is params, responseObject is the Response
      // We need to get the RenderAbortError from the global
      const RenderAbortError = globalThis.RenderAbortError;
      if (RenderAbortError) {
        throw new RenderAbortError(strongComponent, responseOptions, responseObject);
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
    return strongComponent;
  };
}
