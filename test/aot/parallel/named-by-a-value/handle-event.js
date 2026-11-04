class Listener { handleEvent(event) { console.log("handled", event.type); } }
const target = new EventTarget(); target.addEventListener("ping", new Listener()); target.dispatchEvent(new Event("ping"));
