// The same as the cause of an error, and among the errors of an AggregateError.
// Exit code: 1
const params = new URLSearchParams("made=up");
params.toJSON = () => new URL("http://made.up/");
console.log("before");
reportError(new AggregateError([params], "made up"));
throw new Error("made up", { cause: params });
