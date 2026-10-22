const controller = new AbortController();
controller.signal.addEventListener("abort", function (event) {
  console.log(event.type, this === controller.signal, event.target.reason.length);
});
controller.abort("stop");
