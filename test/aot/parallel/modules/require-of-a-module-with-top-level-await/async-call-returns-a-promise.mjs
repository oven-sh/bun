const begin = async () => Promise.resolve(3);
console.log("async-call-returns-a-promise ran", await begin());
export const name = "async-call-returns-a-promise";
