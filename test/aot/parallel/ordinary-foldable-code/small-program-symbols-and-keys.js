const KIND = Symbol("kind");
const PREFIX = "on";
const handlers = { [KIND]: "table", [`${PREFIX}Click`]: () => "clicked", [`${PREFIX}Key`]: () => "typed", [1 + 1]: "two" };
console.log(Object.keys(handlers), handlers[KIND], handlers.onClick(), handlers[2]);
