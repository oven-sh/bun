const result = Promise.withResolvers();
console.log(typeof result, Object.keys(result).join(), typeof result.resolve, result.resolve.length);
console.log(typeof result.reject, result.reject.length, result.promise instanceof Promise);
