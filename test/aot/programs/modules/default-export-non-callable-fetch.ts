// A default export whose fetch is not callable is not a server configuration: no server starts.
console.debug = (message: unknown) => console.log("debug " + String(message).replace(/:\d+$/, ":PORT"));
setTimeout(() => { console.log("no server"); process.exit(0); }, 50);
export default { port: 0, fetch: 1 };
