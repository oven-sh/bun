import { expect } from "bun:test";
const decoded = text => Buffer.from(text).toString();
for (const text of ["process.finalization", "process.allowedNodeEnvironmentFlags", "Bun.SQL"]) {
  const held = (0, eval)(decoded(text));
  let message = "";
  try {
    expect({ held }).toEqual({ other: 1 });
  } catch (error) {
    message = String(error.message);
  }
  console.log(text, message.includes("was not compiled") ? "the printer threw the sentence" : message.includes("held") ? "printed" : message.slice(0, 200));
}
