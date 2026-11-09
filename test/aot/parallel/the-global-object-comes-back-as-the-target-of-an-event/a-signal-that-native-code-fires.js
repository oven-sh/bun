// A control: native code dispatches on the signal, and the event answers the signal.
// STATISTIC: FunctionsLowered <= 1000
const controller = new AbortController();
controller.signal.addEventListener("abort", event => {
  const target = event.target;
  console.log(target === null, target === controller.signal, typeof target, target ? target.aborted : "none");
});
controller.abort();
