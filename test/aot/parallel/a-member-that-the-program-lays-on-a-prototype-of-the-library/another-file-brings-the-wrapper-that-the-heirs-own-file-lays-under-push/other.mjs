import http from "node:http";
export function Ask(socket) { http.IncomingMessage.call(this, socket); }
Object.setPrototypeOf(Ask.prototype, http.IncomingMessage.prototype);
Object.setPrototypeOf(Ask, http.IncomingMessage);
export function lay(o) { Ask.prototype.push = o; }
