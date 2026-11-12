process.on("warning", warning => console.log("heard", warning.name));
const target = new EventTarget();
for (let i = 0; i < 12; i++) target.addEventListener("ring", () => {});
console.log("added");
