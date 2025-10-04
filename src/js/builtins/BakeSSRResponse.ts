export function wrapComponent(
  component,
  responseObject: Response,
  responseOptions: ConstructorParameters<typeof Response>[1],
  kind: 0 | 1 | 2,
) {
  const bakeGetAsyncLocalStorage = $newCppFunction(
    "BakeAdditionsToGlobalObject.cpp",
    "jsFunctionBakeGetAsyncLocalStorage",
    0,
  );

  return function () {
    // For Response.redirect() / Response.render(), throw the response object so
    // we can stop React from rendering
    if (kind === 1 /* JSBakeResponseKind.Redirect */) {
      throw responseObject;
    }

    if (kind === 2 /* JSBakeResponseKind.Render */) {
      throw responseObject;
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
