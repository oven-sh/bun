import { lines, note, mix, registry } from "./declared-1.js";
export async function driveAsyncFunctions(label, promises) {
  for (const result of await Promise.allSettled(promises)) note(label, result.status, result.status === "fulfilled" ? result.value : result.reason);
}

export function print() {
  note("registry", typeof registry.register);
  console.log(lines.slice(0, 600).join("\n"));
  console.log(lines.length, mix(lines.filter(line => !line.startsWith("watched: "))));
}
