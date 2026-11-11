function soon(schedule, done) {
  if (typeof schedule === "function") schedule(done);
}
let said = "nothing";
soon(queueMicrotask.bind(null), () => {
  said = "ran";
});
setTimeout(() => console.log(said), 5);
