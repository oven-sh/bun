// THE CONTROL: with a receiver the methods work on it, however they were found.
let add, send;
const made = new EventTarget();
for (const key in made) {
  if (key.length === 16) add = made[key];
  if (key.length === 13) send = made[key];
}
function heard(event) {
  console.log(event.target === made);
}
add.call(made, "ping", heard);
send.call(made, new Event("ping"));
