// Each method and accessor that the response of a node:http exchange inherits is replaced by one that records its calls, on the object and on each of its prototypes, and four exchanges are served.
process.argv[2] = "response";
await import("../../../js/node/http/probes/replaced-methods-fixture.ts");
export {};
