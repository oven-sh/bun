const target = new EventTarget();
const listener = {
  handleEvent(event) {
    console.log(event.type.length, this === listener);
  },
};
target.addEventListener("ready", listener);
target.dispatchEvent(new Event("ready"));
