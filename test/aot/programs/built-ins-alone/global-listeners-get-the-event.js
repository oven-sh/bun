function listener(event) {
  console.log(event.type, event.detail.size + 1);
}
addEventListener("ready", listener);
dispatchEvent(new CustomEvent("ready", { detail: { size: 1.5 } }));
removeEventListener("ready", listener);
console.log(dispatchEvent(new CustomEvent("ready", { detail: {} })));
