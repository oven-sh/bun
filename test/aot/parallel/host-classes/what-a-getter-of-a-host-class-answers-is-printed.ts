// console.log asks a controller for its `signal` and the signal for its `reason`, and prints what they answer: here a URL, which is printed by util.inspect.
// Alone: what an executable leaves out goes by all that it holds
const controller = new AbortController();
controller.abort(new URL("http://a/b"));
console.log(controller);
console.dir(controller);
console.table([{ controller }]);

export {};
