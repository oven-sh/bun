// Used by async_hooks to manipulate the async context

export function getAsyncContext(): any[] | undefined {
  return $getInternalField($asyncContext, 0);
}

export function setAsyncContext(contextValue: any[] | undefined) {
  return $putInternalField($asyncContext, 0, contextValue);
}
