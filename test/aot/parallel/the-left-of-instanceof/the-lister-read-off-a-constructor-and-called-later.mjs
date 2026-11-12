const list = ({}).constructor.getOwnPropertySymbols;
const [hook] = list(Object.getPrototypeOf(() => {}));
const kind = { [hook](value) { return typeof value.allowedNodeEnvironmentFlags.has === "function"; } };
console.log("SAID", process instanceof kind);
