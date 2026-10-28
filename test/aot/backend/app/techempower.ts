// The six test types of the TechEmpower Framework Benchmarks.
import { allFortunes, findWorld, saveWorlds, type Fortune, type World } from "./database";

const headers = { Server: "Bun" };

function randomNumber(): number {
  return Math.floor(Math.random() * 10000) + 1;
}

function requestedCount(request: Request): number {
  const count = parseInt(new URL(request.url).searchParams.get("queries") ?? "", 10);
  return Number.isNaN(count) ? 1 : Math.min(Math.max(count, 1), 500);
}

function randomWorlds(count: number): Promise<World[]> {
  return Promise.all(Array.from({ length: count }, () => findWorld(randomNumber())));
}

function renderFortunes(fortunes: Fortune[]): string {
  let rows = "";
  for (const { id, message } of fortunes) rows += `<tr><td>${id}</td><td>${Bun.escapeHTML(message)}</td></tr>`;
  return `<!DOCTYPE html><html><head><title>Fortunes</title></head><body><table><tr><th>id</th><th>message</th></tr>${rows}</table></body></html>`;
}

export function plaintext(): Response {
  return new Response("Hello, World!", { headers });
}

export function json(): Response {
  return Response.json({ message: "Hello, World!" }, { headers });
}

export async function db(): Promise<Response> {
  return Response.json(await findWorld(randomNumber()), { headers });
}

export async function queries(request: Request): Promise<Response> {
  return Response.json(await randomWorlds(requestedCount(request)), { headers });
}

export async function fortunes(): Promise<Response> {
  const fortunes = await allFortunes();
  fortunes.push({ id: 0, message: "Additional fortune added at request time." });
  fortunes.sort((a, b) => (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
  return new Response(renderFortunes(fortunes), { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

export async function updates(request: Request): Promise<Response> {
  const worlds = await randomWorlds(requestedCount(request));
  for (const world of worlds) world.randomNumber = randomNumber();
  await saveWorlds(worlds);
  return Response.json(worlds, { headers });
}
