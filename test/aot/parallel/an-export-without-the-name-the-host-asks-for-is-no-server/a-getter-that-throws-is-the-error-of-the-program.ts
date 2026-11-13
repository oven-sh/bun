// Exit code: 1
// A `fetch` that the default export has, and whose getter throws, is an error of the program, as it is where the program reads it.
export default {
  get fetch(): never {
    console.log("asked");
    throw new Error("read of fetch");
  },
};
setTimeout(() => console.log("tick"), 1);
console.log("ran");
