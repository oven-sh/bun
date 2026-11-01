// Rejection is caught later in the same turn: compiled answers as plain.
const p = Promise.reject(new Error("late"));
let got;
p.catch(e => {
  got = e.message;
});
await null;
await null;
console.log(got);
