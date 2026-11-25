const made = Promise.resolve(4);
const got = (Promise.prototype as any)[process.argv[2] ?? atob("dGhlbg==")];
console.log("SAID", typeof got, await got.call(made, (value: number) => value + 1), await got.call(Promise.reject(new Error("no")), undefined, (error: Error) => error.message));
