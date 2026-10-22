// functions-native-code-calls/event-listener-whose-promise-is-rejected with a listener that is stored, not passed to a call.
process.on("uncaughtException", error => console.log("uncaught: " + error));
const controller = new AbortController();
controller.signal.onabort = () => Promise.reject("thrown by the handler");
controller.abort();
console.log("aborted");
