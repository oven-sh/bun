// A control: the event is sent on a target that the program has made: the global object goes nowhere.
// STATISTIC: FunctionsLowered <= 1000
const own = new EventTarget();
own.addEventListener("ping", event => {
  console.log(event.target === own, typeof event.target.process);
});
own.dispatchEvent(new Event("ping"));
