class Own extends Promise {}
await Own.resolve(1);
console.log("promise-subclass ran");
export const name = "promise-subclass";
