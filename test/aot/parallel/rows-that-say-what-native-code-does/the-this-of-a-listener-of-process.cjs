// All listeners of process are called with the object that a listener was last added through.
const other = { _events: process, on: process.on };
process.on("exit", function () {
  console.log(this === process, this === other);
});
other.on("an-event-that-nobody-emits", () => {});
