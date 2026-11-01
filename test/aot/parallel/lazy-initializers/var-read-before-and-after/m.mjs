function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

export const early = () => typeof state;
export const seenEarly = early();
var state = make("late");
export const read = () => state;
