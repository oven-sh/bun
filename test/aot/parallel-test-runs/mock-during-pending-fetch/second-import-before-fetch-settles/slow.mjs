export const get = () => "real";
console.log("| body begins");
await new Promise(done => setTimeout(done, 20));
console.log("| body ends");
