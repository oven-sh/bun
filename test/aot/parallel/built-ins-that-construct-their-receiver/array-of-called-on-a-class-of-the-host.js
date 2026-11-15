// Array.of constructs its receiver: out of the code of the engine comes an object of a class of the host, and what hangs on such objects must be in the executable.
process.on("warning", warning => console.log("heard", warning.name));
const target = Array.of.call(EventTarget, 1);
for (let i = 0; i < 12; i++) target.addEventListener("ring", () => {});
console.log(target instanceof EventTarget, target.constructor.name, target[0], target.length);
