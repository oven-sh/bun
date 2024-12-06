import assert from "node:assert";
import { existsSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { argParse } from "./helpers";

// arg parsing
let { "codegen-root": codegenRoot, debug, ...rest } = argParse(["codegen-root", "debug"]);
if (debug === "false" || debug === "0" || debug == "OFF") debug = false;
if (!codegenRoot) {
  console.error("Missing --codegen-root=...");
  process.exit(1);
}

const base_dir = join(import.meta.dirname, "../bake");
process.chdir(base_dir); // to make bun build predictable in development

function convertZigEnum(zig: string) {
  const startTrigger = "\npub const MessageId = enum(u8) {";
  const start = zig.indexOf(startTrigger) + startTrigger.length;
  const endTrigger = /\n    pub (inline )?fn |\n};/g;
  const end = zig.slice(start).search(endTrigger) + start;
  const enumText = zig.slice(start, end);
  const values = enumText.replaceAll("\n    ", "\n  ").replace(/\n\s*(\w+)\s*=\s*'(.+?)',/g, (_, name, value) => {
    return `\n  ${name} = ${value.charCodeAt(0)},`;
  });
  return `/** Generated from DevServer.zig */\nexport const enum MessageId {${values}}`;
}

async function run() {
  const devServerZig = readFileSync(join(base_dir, "DevServer.zig"), "utf-8");
  writeFileSync(join(base_dir, "generated.ts"), convertZigEnum(devServerZig));

  const results = await Promise.allSettled(
    ["client", "server", "error"].map(async file => {
      const side = file === "error" ? "client" : file;
      let result = await Bun.build({
        entrypoints: [join(base_dir, `hmr-runtime-${file}.ts`)],
        define: {
          side: JSON.stringify(side),
          IS_BUN_DEVELOPMENT: String(!!debug),
        },
        minify: {
          syntax: !debug,
        },
        target: side === "server" ? "bun" : "browser",
      });
      if (!result.success) throw new AggregateError(result.logs);
      assert(result.outputs.length === 1, "must bundle to a single file");
      // @ts-ignore
      let code = await result.outputs[0].text();

      // A second pass is used to convert global variables into parameters, while
      // allowing for renaming to properly function when minification is enabled.
      const in_names = [
        file !== "error" && "input_graph",
        file !== "error" && "config",
        file === "server" && "server_exports",
        file === "server" && "$separateSSRGraph",
        file === "server" && "$importMeta",
      ].filter(Boolean);
      const combined_source =
        file === "error"
          ? code
          : `
            __marker__;
            ${in_names.length > 0 ? "let" : ""} ${in_names.join(",")};
            __marker__(${in_names.join(",")});
            ${code};
          `;
      const generated_entrypoint = join(base_dir, `.runtime-${file}.generated.ts`);

      writeFileSync(generated_entrypoint, combined_source);

      result = await Bun.build({
        entrypoints: [generated_entrypoint],
        minify: !debug,
      });
      if (!result.success) throw new AggregateError(result.logs);
      assert(result.outputs.length === 1, "must bundle to a single file");
      code = (await result.outputs[0].text()).replace(`// ${basename(generated_entrypoint)}`, "").trim();

      rmSync(generated_entrypoint);

      if (code.includes("export default ")) {
        throw new AggregateError([
          new Error("export default is not allowed in bake codegen. this became a commonjs module!"),
        ]);
      }

      if (file !== "error") {
        let names: string = "";
        code = code
          .replace(/(\n?)\s*__marker__.*__marker__\((.+?)\);\s*/s, (_, n, captured) => {
            names = captured;
            return n;
          })
          .trim();
        assert(names, "missing name");
        const split_names = names.split(",").map(x => x.trim());
        const out_names = Object.fromEntries(in_names.map((x, i) => [x, split_names[i]]));
        function outName(name) {
          if (!out_names[name]) throw new Error(`missing out name for ${name}`);
          return out_names[name];
        }

        if (debug) {
          code = "\n  " + code.replace(/\n/g, "\n  ") + "\n";
        }

        if (code[code.length - 1] === ";") code = code.slice(0, -1);

        if (side === "server") {
          code = debug
            ? `${code}  return ${outName("server_exports")};\n`
            : `${code};return ${outName("server_exports")};`;

          const params = `${outName("$separateSSRGraph")},${outName("$importMeta")}`;
          code = code.replaceAll("import.meta", outName("$importMeta"));
          code = `let ${outName("input_graph")}={},${outName("config")}={separateSSRGraph:${outName("$separateSSRGraph")}},${outName("server_exports")};${code}`;

          code = debug ? `((${params}) => {${code}})\n` : `((${params})=>{${code}})\n`;
        } else {
          code = debug ? `((${names}) => {${code}})({\n` : `((${names})=>{${code}})({`;
        }
      }

      writeFileSync(join(codegenRoot, `bake.${file}.js`), code);
    }),
  );

  // print failures in a de-duplicated fashion.
  interface Err {
    kind: ("client" | "server" | "error")[];
    err: any;
  }
  const failed = [
    { kind: ["client"], result: results[0] },
    { kind: ["server"], result: results[1] },
    { kind: ["error"], result: results[2] },
  ]
    .filter(x => x.result.status === "rejected")
    .map(x => ({ kind: x.kind, err: x.result.reason })) as Err[];
  if (failed.length > 0) {
    const flattened_errors: Err[] = [];
    for (const { kind, err } of failed) {
      if (err instanceof AggregateError) {
        flattened_errors.push(...err.errors.map(err => ({ kind, err })));
      }
      flattened_errors.push({ kind, err });
    }
    for (let i = 0; i < flattened_errors.length; i++) {
      const x = flattened_errors[i];
      if (!x.err?.message) continue;
      for (const other of flattened_errors.slice(0, i)) {
        if (other.err?.message === x.err.message || other.err.stack === x.err.stack) {
          other.kind = [...x.kind, ...other.kind];
          flattened_errors.splice(i, 1);
          i -= 1;
          continue;
        }
      }
    }
    for (const { kind, err } of flattened_errors) {
      const map = { error: "error runtime", client: "client runtime", server: "server runtime" };
      console.error(`Errors while bundling Bake ${kind.map(x => map[x]).join(" and ")}:`);
      console.error(err);
    }
  } else {
    console.log("-> bake.client.js, bake.server.js, bake.error.js");

    const empty_file = join(codegenRoot, "bake_empty_file");
    if (!existsSync(empty_file)) writeFileSync(empty_file, "this is used to fulfill a cmake dependency");
  }
}

await run();
