import http from "stream-http";
export var { request, ClientRequest, IncomingMessage, Agent, globalAgent, STATUS_CODES, METHODS } = http;
// The bundler numbers a function expression named like an export (`get2`). This export has another binding name.
var httpGet = http.get;
export { httpGet as get };
export default http;
