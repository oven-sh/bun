Promise.resolve().then(() => console.log("a job that was waiting"));
const bun = await import("bun");
console.log("behind", typeof bun.version);
Promise.resolve().then(() => console.log("a second job"));
console.log("behind", typeof (await import("bun")).inspect);
