// A file throws in a require() that is caught, and is imported in the same synchronous load: a default import and a named one stop at the link. An import for its effects alone and a file that works run on.
const show = e => console.log(e.name, e.message.replace(/[^"' ]*\//g, ""));
await import("./default/start.cjs").then(() => console.log("default loaded"), show);
await import("./lazy/start.cjs").then(() => console.log("lazy loaded"), show);
await import("./inner/start.cjs").then(() => console.log("inner loaded"), show);
await import("./named/start.cjs").then(() => console.log("named loaded"), show);
await import("./works/start.cjs").then(() => console.log("works loaded"), show);
await import("./effects/start.cjs").then(() => console.log("effects loaded"), show);
