// console.log asks a controller for its `signal` and the signal for its `reason`, and prints what they answer: here a URL, which is printed by util.inspect.
const controller = new AbortController();
controller.abort(new URL("http://a/b"));
console.log(controller);
console.dir(controller);
console.table([{ controller }]);

export {};
