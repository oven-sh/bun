const t = "then"; class T { [t](resolve) { resolve(5); } }
console.log(await new T(), await Promise.resolve(new T()), (await Promise.all([new T()])).join());
