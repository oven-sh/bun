class Later { then(resolve) { resolve("later"); } }
console.log(await new Later(), await Promise.resolve(new Later()));
