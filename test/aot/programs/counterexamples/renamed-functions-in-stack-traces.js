// A stack trace shows the name that `defineProperty` gave a function, and its `displayName`.
function original() { return new Error("x").stack; }
function plain() { return new Error("x").stack; }
Object.defineProperty(original, "name", { value: "renamed" });
plain.displayName = "shown";
console.log(original().includes("renamed"), plain().includes("shown"));
