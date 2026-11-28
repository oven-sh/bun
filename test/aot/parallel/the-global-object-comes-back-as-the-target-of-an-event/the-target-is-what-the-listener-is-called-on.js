// The target of an event on the global object is `globalThis` itself, and so is `this` of a listener that is no arrow function.
addEventListener("ping", function (event) {
  console.log(this === globalThis, event.target === globalThis, event.currentTarget === globalThis, event.srcElement === globalThis);
  console.log(event.composedPath().length, event.composedPath()[0] === globalThis);
});
const event = new Event("ping");
console.log(dispatchEvent(event), event.target === globalThis, event.currentTarget);
