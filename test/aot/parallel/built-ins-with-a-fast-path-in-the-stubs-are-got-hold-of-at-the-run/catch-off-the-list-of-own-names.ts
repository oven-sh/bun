const got = (Promise.prototype as any)[Object.getOwnPropertyNames(Promise.prototype).find(each => each.length === 5 && each.startsWith("cat"))!];
console.log("SAID", typeof got, await got.call(Promise.reject(new Error("no")), (error: Error) => error.message), await got.call(Promise.resolve(3), () => 0));
