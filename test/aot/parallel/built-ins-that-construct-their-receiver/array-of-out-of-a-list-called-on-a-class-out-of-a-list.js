const unseen = x => [x][JSON.parse("0")];
process.on("warning", warning => console.log("heard", warning.name));
const target = unseen(Array.of).call(unseen(EventTarget), 1);
for (let i = 0; i < 12; i++) target.addEventListener("ring", () => {});
console.log(target instanceof EventTarget, target[0]);
