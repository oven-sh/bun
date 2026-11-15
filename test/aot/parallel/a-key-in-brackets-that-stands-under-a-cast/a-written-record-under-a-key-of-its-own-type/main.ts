const handlers = { info: () => "i", warn: () => "w" };
type Level = keyof typeof handlers;
console.log(handlers["warn" as Level]());
