interface Glob {
  $pull(opts);
  $resolveSync(opts);
}

export function scan(this: Glob, opts) {
  const valuesPromise = this.$pull(opts);
  
  // Check if this is a call with advanced options that should return a structured result
  const hasAdvancedOptions = opts && (
    typeof opts === 'object' && (
      opts.limit !== undefined || 
      opts.offset !== undefined || 
      opts.sort !== undefined ||
      opts.ignore !== undefined ||
      opts.nocase !== undefined
    )
  );
  
  if (hasAdvancedOptions) {
    // Return the promise directly for structured results
    return valuesPromise;
  }
  
  // Return async iterator for backward compatibility
  async function* iter() {
    const values = (await valuesPromise) || [];
    yield* values;
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
