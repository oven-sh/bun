// Used to make a Response fake being a component
// When this is called, it will render the component and then update async local
// storage with the options of the Response
export function wrapComponent(strongComponent, responseOptions) {
  const bakeGetAsyncLocalStorage = $newZigFunction("bun.js/webcore/Response.zig", "bakeGetAsyncLocalStorage", 0);

  return () => {
    // Update the AsyncLocalStorage with the response options
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
