console.log((await Promise.any([Promise.reject(0), Promise.resolve("two")])).length);
