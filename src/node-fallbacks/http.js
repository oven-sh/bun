import http from "stream-http";
export var { request, ClientRequest, IncomingMessage, Agent, globalAgent, STATUS_CODES, METHODS } = http;
// `get` has another binding name here. stream-http has functions named `get`, and a bundle that has this
// module's exports object numbers each function expression that has the name of an export (`get2`).
var httpGet = http.get;
export { httpGet as get };
export default http;
