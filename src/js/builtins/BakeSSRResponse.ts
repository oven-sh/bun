// Used to make a Response fake being a component
// When this is called, it will render the component and then update async local
// storage with the options of the Response
export function wrapComponent(strongComponent, responseOptions) {
  const bunUpdateAsyncLocalStorage = $newZigFunction("bun.js/webcore/Response.zig", "bunUpdateAsyncLocalStorage", 2);

  return () => {
    // Update the AsyncLocalStorage with the response options
    bunUpdateAsyncLocalStorage(responseOptions);
    return strongComponent;
  };
}
