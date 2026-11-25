process.on("warning", warning => console.log("heard", warning.name));
const target = Array.from.call(EventTarget, [1, 2]);
for (let i = 0; i < 12; i++) target.addEventListener("ring", () => {});
console.log(target instanceof EventTarget, target[1], target.length);
