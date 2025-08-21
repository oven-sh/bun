interface Glob {
  $pull(opts);
  $resolveSync(opts);
}

export function scan(this: Glob, opts) {
  // Check if this is a call with advanced options that should return a structured result
  const hasAdvancedOptions = opts && (
    typeof opts === 'object' && (
      opts.limit !== undefined || 
      opts.offset !== undefined || 
      opts.sort !== undefined ||
      opts.ignore !== undefined ||
      opts.nocase !== undefined ||
      opts.signal !== undefined
    )
  );
  
  if (hasAdvancedOptions) {
    // Return the promise directly for structured results, with error conversion
    return this.$pull(opts).catch(error => {
      // Check for various abort signal error codes
      if (error?.code === "ECANCELED" || error?.name === "AbortError" || error?.code === "ABORT_ERR") {
        throw $makeAbortError();
      }
      throw error;
    });
  }
  
  // Return async iterator for backward compatibility
  const self = this;
  async function* iter() {
    try {
      const values = (await self.$pull(opts)) || [];
      yield* values;
    } catch (error) {
      // Check for various abort signal error codes
      if (error?.code === "ECANCELED" || error?.name === "AbortError" || error?.code === "ABORT_ERR") {
        throw $makeAbortError();
      }
      throw error;
    }
  }
  return iter();
}

export function scanSync(this: Glob, opts) {
  const arr = this.$resolveSync(opts) || [];
  function* iter() {
    yield* arr;
  }
  return iter();
}
