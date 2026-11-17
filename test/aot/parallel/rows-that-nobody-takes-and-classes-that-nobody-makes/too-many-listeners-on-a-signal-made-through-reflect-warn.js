process.on("warning", warning => console.log("heard", warning.name));
const controller = Reflect.construct(AbortController, []);
for (let i = 0; i < 12; i++) controller.signal.addEventListener("abort", () => {});
console.log("added", controller.signal.aborted);
