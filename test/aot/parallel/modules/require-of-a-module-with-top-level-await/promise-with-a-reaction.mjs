const begin = async () => {};
const pending = begin();
pending.then(() => console.log("reaction of promise-with-a-reaction"));
await pending;
console.log("promise-with-a-reaction ran");
export const name = "promise-with-a-reaction";
