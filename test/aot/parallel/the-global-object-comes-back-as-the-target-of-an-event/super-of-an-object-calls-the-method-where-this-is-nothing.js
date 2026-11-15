"use strict";
const { signal } = new AbortController();
const event = new Event("ping");
const own = { send(given) { return super.dispatchEvent(given); } };
Object.setPrototypeOf(own, signal);
const { send } = own;
send(event);
console.log(typeof event.target.process.finalization);
