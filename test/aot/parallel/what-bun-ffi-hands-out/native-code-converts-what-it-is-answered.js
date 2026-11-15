// Only native code enters valueOf() of what a callback answers and the getter of an operand that stands for an address.
const { callback, cfunction, closeCallback } = Bun.FFI;
const answer = {
  valueOf() {
    console.log("answer asked");
    return 41;
  },
};
const place = {
  get ptr() {
    console.log("place asked");
    return 8;
  },
};
const made = callback({ args: ["ptr"], returns: "i32" }, where => {
  console.log(where);
  return answer;
});
console.log(cfunction({ ptr: made.ptr, args: ["ptr"], returns: "i32" }, "enter")(place));
closeCallback(made);
