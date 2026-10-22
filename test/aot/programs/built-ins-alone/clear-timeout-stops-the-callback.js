let state = "waiting";
const timer = setTimeout(() => {
  state = 0.5;
}, 0);
clearTimeout(timer);
setTimeout(() => console.log(typeof state, state.length), 5);
