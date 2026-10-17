import compression from "compression";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import morgan from "morgan";
import multer from "multer";
import type { AddressInfo } from "node:net";

declare module "express-session" { interface SessionData { visits: number } }

const logged: string[] = [];
const app = express();
app.use(helmet());
app.use(cors({ origin: "https://example.test" }));
app.use(compression({ threshold: 0 }));
app.use(morgan(":method :url :status", { stream: { write: line => void logged.push(line.trim()) } }));
app.use(cookieParser("a secret of the test"));
app.use(session({ secret: "another secret", resave: false, saveUninitialized: false, name: "sid" }));
app.use("/limited", rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: "draft-7", legacyHeaders: false }));
app.get("/visits", (request, response) => { request.session.visits = (request.session.visits ?? 0) + 1; response.json({ visits: request.session.visits }); });
app.get("/cookie", (request, response) => { response.cookie("who", "ada", { signed: true }); response.json({ had: request.signedCookies["who"] ?? null }); });
app.post("/upload", multer().single("file"), (request, response) => { response.json({ name: request.file?.originalname, text: request.file?.buffer.toString(), word: (request.body as { word?: string }).word }); });
app.get("/limited", (_request, response) => { response.send("let through"); });
app.get("/big", (_request, response) => { response.send("x".repeat(5000)); });
app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => { response.status(500).json({ error: error.message }); });
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
let jar = "";
const form = new FormData();
form.set("word", "sent in a form");
form.set("file", new File(["the text of a file"], "note.txt", { type: "text/plain" }));
for (const [path, init] of [["/visits"], ["/visits"], ["/cookie"], ["/cookie"], ["/upload", { method: "POST", body: form }], ["/limited"], ["/limited"], ["/limited"], ["/big"], ["/nowhere"]] as [string, RequestInit?][]) {
  const response = await fetch(base + path, { ...init, headers: { cookie: jar, origin: "https://example.test" } });
  for (const set of response.headers.getSetCookie()) jar = [jar, set.split(";")[0]].filter(Boolean).join("; ");
  const text = await response.text();
  console.log(path, response.status, response.headers.get("access-control-allow-origin"), response.headers.get("x-frame-options"), response.headers.get("content-encoding"), response.headers.get("ratelimit")?.split(",")[1]?.trim() ?? "-", text.length > 100 ? text.length : text.replace(/\s+/g, " "));
}
server.close();
console.log(logged.join(" | "));
console.log("DONE");
