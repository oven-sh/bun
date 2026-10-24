// docs/bundler/aot-compatibility.mdx, "Fastify": ajv makes a validator with `new Function`, which a compiled executable interprets.
// @fastify/ajv-compiler can write the validator to a file instead. The file is compiled with the program, and the server answers as it
// does with the validator that ajv makes at run time.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const server = `
import { StandaloneValidator } from "@fastify/ajv-compiler";
import Fastify from "fastify";
import { writeFileSync } from "node:fs";

const mode = process.argv[2];
const buildValidator =
  mode === "write"
    ? StandaloneValidator({ readMode: false, storeFunction: (route: unknown, code: string) => writeFileSync("./order-validator.js", code) })
    : StandaloneValidator({ readMode: true, restoreFunction: () => require("./order-validator.js") });

const app = Fastify(mode === "at-run-time" ? {} : { schemaController: { compilersFactory: { buildValidator } } });
app.setSerializerCompiler(() => JSON.stringify);

interface Order {
  customer: string;
  items: { sku: string; quantity: number; unitCents: number }[];
}

app.post<{ Body: Order }>(
  "/orders",
  {
    schema: {
      body: {
        type: "object",
        additionalProperties: false,
        required: ["customer", "items"],
        properties: {
          customer: { type: "string", minLength: 1, maxLength: 20, pattern: "^[a-z]+$" },
          items: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["sku", "quantity", "unitCents"],
              properties: { sku: { type: "string" }, quantity: { type: "integer", minimum: 1 }, unitCents: { type: "integer", minimum: 0 } },
            },
          },
        },
      },
      response: { 200: { type: "object", properties: { customer: { type: "string" }, totalCents: { type: "integer" } } } },
    },
  },
  async request => ({
    customer: request.body.customer,
    totalCents: request.body.items.reduce((sum, item) => sum + item.quantity * item.unitCents, 0),
  }),
);

await app.ready();
if (mode !== "write") {
  const item = { sku: "a-1", quantity: 2, unitCents: 150 };
  for (const payload of [
    { customer: "ada", items: [item, { sku: "b-2", quantity: 1, unitCents: 99 }] },
    { customer: "ada", items: [] },
    { customer: "Ada", items: [item] },
    { customer: "ada", items: [{ sku: "a-1", quantity: 0, unitCents: 150 }] },
    { customer: "ada", items: [{ sku: "a-1", quantity: 2 }] },
    { items: [item] },
    [item],
  ]) {
    const response = await app.inject({ method: "POST", url: "/orders", payload });
    console.log(response.statusCode, response.body);
  }
}
await app.close();
`;

const answers = `200 {"customer":"ada","totalCents":399}
400 {"statusCode":400,"code":"FST_ERR_VALIDATION","error":"Bad Request","message":"body/items must NOT have fewer than 1 items"}
400 {"statusCode":400,"code":"FST_ERR_VALIDATION","error":"Bad Request","message":"body/customer must match pattern \\"^[a-z]+$\\""}
400 {"statusCode":400,"code":"FST_ERR_VALIDATION","error":"Bad Request","message":"body/items/0/quantity must be >= 1"}
400 {"statusCode":400,"code":"FST_ERR_VALIDATION","error":"Bad Request","message":"body/items/0 must have required property 'unitCents'"}
400 {"statusCode":400,"code":"FST_ERR_VALIDATION","error":"Bad Request","message":"body must have required property 'customer'"}
400 {"statusCode":400,"code":"FST_ERR_VALIDATION","error":"Bad Request","message":"body must be object"}
`;

test("a validator that Fastify wrote to a file is compiled with the program", async () => {
  using dir = tempDir("aot-fastify-validators", { "server.ts": server });
  const folder = String(dir);

  // The packages as `bun add fastify @fastify/ajv-compiler ajv` lays them out, out of what the tests have installed.
  const folderOf = (name: string, from: string) => realpathSync(dirname(Bun.resolveSync(name + "/package.json", from)));
  const fastify = folderOf("fastify", import.meta.dir);
  const compiler = folderOf("@fastify/ajv-compiler", fastify);
  mkdirSync(join(folder, "node_modules", "@fastify"), { recursive: true });
  symlinkSync(fastify, join(folder, "node_modules", "fastify"), "junction");
  symlinkSync(compiler, join(folder, "node_modules", "@fastify", "ajv-compiler"), "junction");
  symlinkSync(folderOf("ajv", compiler), join(folder, "node_modules", "ajv"), "junction");

  const written = await run([bunExe(), "server.ts", "write"], folder);
  expect({ ...written, stdout: "" }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  expect(readFileSync(join(folder, "order-validator.js"), "utf8")).toStartWith(
    '"use strict";module.exports = validate',
  );

  const executable = join(folder, isWindows ? "server.exe" : "server");
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-report=report.json",
      "--aot-report-detail=functions",
      "server.ts",
      "--outfile",
      executable,
    ],
    folder,
  );
  expect(built.stderr).not.toContain("error");
  expect(built.exitCode).toBe(0);

  const functions: { file: string; name: string; codeBytes: number }[] = JSON.parse(
    readFileSync(join(folder, "report.json"), "utf8"),
  ).functions;
  expect(
    functions.filter(
      ({ file, name, codeBytes }) =>
        file.endsWith("order-validator.js") && name.startsWith("validate") && codeBytes > 0,
    ),
  ).not.toBeEmpty();

  expect(await run([executable], folder, bunEnv)).toEqual({ stdout: answers, stderr: "", exitCode: 0 });
  expect(await run([executable, "at-run-time"], folder, bunEnv)).toEqual({ stdout: answers, stderr: "", exitCode: 0 });
  expect(await run([bunExe(), "server.ts"], folder)).toEqual({ stdout: answers, stderr: "", exitCode: 0 });
}, 240_000);
