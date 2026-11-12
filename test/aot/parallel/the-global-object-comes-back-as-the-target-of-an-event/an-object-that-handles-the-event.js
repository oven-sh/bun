addEventListener("ping", {
  handleEvent(event) {
    console.log(typeof event.target.process.finalization);
  },
});
dispatchEvent(new Event("ping"));
