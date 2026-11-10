// Exit code: 1
const params = new URLSearchParams("a=b"); Object.defineProperty(params, "toJSON", { value: () => new URL("http://made.up/") }); console.log("before"); throw params;
