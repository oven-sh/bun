function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

let state;
export const early = () => state;
export const seenEarly = early();
state = make("late");
export const read = () => state;
