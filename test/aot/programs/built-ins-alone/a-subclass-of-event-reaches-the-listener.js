class Sized extends Event {
  size = 1.5;
}
const target = new EventTarget();
target.addEventListener("ready", event => console.log(event instanceof Sized, event.size + 1));
target.dispatchEvent(new Sized("ready"));
