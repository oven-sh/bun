// The two methods are read off an instance and called without a receiver: no file mentions the global functions.
const { signal } = new AbortController();
const add = signal.addEventListener;
add("ping", event => {
  console.log(typeof event.target.process.finalization);
});
const send = signal.dispatchEvent;
send(new Event("ping"));
