// The function is kept under another name and called there.
const send = dispatchEvent;
addEventListener("ping", event => {
  console.log(typeof event.target.process.finalization);
});
send(new Event("ping"));
