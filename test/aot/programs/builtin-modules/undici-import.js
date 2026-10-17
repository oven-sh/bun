import { FormData, Headers, Request, Response, WebSocket } from "undici";

const headers = new Headers({ "content-type": "text/plain" });
const request = new Request("http://localhost/a?x=1", { method: "POST", body: "text", headers });
const response = new Response("answer", { status: 201 });
const form = new FormData();
form.append("name", "value");
console.log(headers.get("content-type"), request.method, new URL(request.url).search, response.status, await response.text(), form.get("name"), typeof WebSocket);
