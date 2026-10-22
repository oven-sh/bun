const target = new EventTarget();
target.addEventListener("ready", function (event) {
  console.log(event.type.length, this === target, event.detail.size + 1);
});
console.log(target.dispatchEvent(new CustomEvent("ready", { detail: { size: 1.5 } })));
