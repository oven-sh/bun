import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { AddressInfo, Server as NetServer } from "node:net";

export function listen(server: HttpServer | NetServer): Promise<number> {
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));
}

export function readBody(request: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

export async function timed<T>(label: string, work: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const value = await work();
  console.log("TIME " + label + " " + (performance.now() - start).toFixed(1) + " ms");
  return value;
}

export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
