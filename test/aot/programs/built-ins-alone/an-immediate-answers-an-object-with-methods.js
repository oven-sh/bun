let state = "waiting";
const immediate = setImmediate(() => {
  state = 0.5;
});
console.log(typeof immediate, immediate.hasRef(), immediate.unref() === immediate, immediate.ref() === immediate);
clearImmediate(immediate);
setTimeout(() => console.log(typeof state, state.length), 2);
