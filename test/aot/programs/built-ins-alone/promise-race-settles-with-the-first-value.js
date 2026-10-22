console.log((await Promise.race([new Promise(() => {}), Promise.resolve("two")])).length);
