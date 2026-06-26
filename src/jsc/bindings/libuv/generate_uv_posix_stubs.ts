import { join } from "path";
import { symbols, test_skipped } from "./generate_uv_posix_stubs_constants";

import Parser from "tree-sitter";
import C from "tree-sitter-c";

const parser = new Parser();
parser.setLanguage(C);

const overrides = {
  uv_setup_args: {
    args: ["argc", "argv"],
    decls: ["int argc", "char **argv"],
  },
  uv_udp_try_send2: {
    args: ["arg0", "arg1", "arg2", "arg3", "arg4", "arg5"],
    decls: [
      "uv_udp_t* arg0",
      "unsigned int arg1",
      "uv_buf_t** arg2",
      "unsigned int* arg3",
      "struct sockaddr** arg4",
      "unsigned int arg5",
    ],
  },
};

type TestInfo = {
  decls: string[];
  args: string[];
};

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

/**
 * 1. Use ripgrep to find the filename + line number of the symbol's declaration is in the libuv headers
 * 2. Find the range of text which makes up the declaration
 * 3. Generate and return stub
 */
async function generate(symbol_name: string): Promise<[stub: string, symbol_name: string, types: TestInfo]> {
  console.log("Looking for", symbol_name);

  const HEADER_PATH = import.meta.dir;

  const output = await Bun.$`rg -n ${symbol_name + "\\("}`.cwd(HEADER_PATH).text();

  if (!output.includes("UV_EXTERN")) {
    console.error("Symbol not found!");
    process.exit(1);
  }

  let matches: { filename: string; lineNumber: number; rest: string }[] = [];

  const lines = output.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = parseOutput(line);
    if (!match) continue;
    const { filename, lineNumber, rest } = match;
    if (!rest.includes("UV_EXTERN")) continue;

    // ending in one line
    if (rest.indexOf(";") == rest.length - 1) {
      // console.log("Found single liner!");
      matches.push({ filename, lineNumber, rest });
    } else {
      const absoluteFilepath = join(HEADER_PATH, filename);
      const fileContents = await Bun.file(absoluteFilepath).text();
      console.log(absoluteFilepath, "Found multi-liner!", lineNumber);
      const fileLines = fileContents.split("\n");
      let found = false;
      let j = lineNumber;
      while (j < fileLines.length) {
        if (fileLines[j].indexOf(";") == fileLines[j].length - 1) {
          found = true;
          break;
        }
        console.log("j", j);
        j++;
      }
      if (!found) {
        console.error("Multi-liner end not found!");
        process.exit(1);
      }
      const multiLine = fileLines.slice(lineNumber, j + 1).join("\n");
      console.log(`MULTILINE (${lineNumber} -> ${j + 1})`);
      matches.push({ filename, lineNumber, rest: multiLine });
      // console.log(matches[matches.length - 1]);
      i = j;
    }
  }

  if (matches.length !== 1) {
    console.error("Found", matches.length, "matches!");
    console.error(matches);
    process.exit(1);
  }

  const { filename, lineNumber, rest } = matches[0];

  function extractParameterTypes(decl: string): TestInfo {
    if (overrides[symbol_name]) return overrides[symbol_name];
    console.log("DECL", decl);
    decl = decl.replace("UV_EXTERN", "");
    const rootNode = parser.parse(decl).rootNode;
    assert(rootNode.children[0].type === "declaration", "Root node must be a declaration");
    const declNode = rootNode.children[0];
    console.log("DECL NODE", declNode.children);
    let functionDeclNode = declNode.children.find(n => n.type === "function_declarator")!;
    // it can be a PointerDeclaratorNode:
    // uv_loop_t* uv_default_loop
    if (!functionDeclNode) {
      const pointerDeclaratorNode = declNode.children.find(n => n.type === "pointer_declarator")!;
      assert(!!pointerDeclaratorNode, "Pointer declarator not found");
      console.log("POINTER DECLARATOR", pointerDeclaratorNode.children);
      functionDeclNode = pointerDeclaratorNode.children.find(n => n.type === "function_declarator")!;
    }
    assert(!!functionDeclNode, "Function declarator not found");
    const parameterListNode = functionDeclNode.children.find(n => n.type === "parameter_list")!;
    assert(!!parameterListNode, "Parameter list not found");
    const parameterDeclarationNodes = parameterListNode.children.filter(n => n.type === "parameter_declaration")!;
    assert(parameterDeclarationNodes.length > 0, "Must have exactly one parameter declaration");

    let decls: string[] = [];
    let args: string[] = [];

    let i = 0;
    for (const parameterDeclarationNode of parameterDeclarationNodes) {
      console.log("PARAM", parameterDeclarationNode.children.length, parameterDeclarationNode.text);
      const last_idx = parameterDeclarationNode.children.length - 1;
      const last = parameterDeclarationNode.children[last_idx];
      if (last.type === "primitive_type") {
        if (last.text === "void") {
          decls.push("(void) 0");
          args.push("void");
          continue;
        }
        const arg = `arg${i++}`;
        decls.push(`${last.text} ${arg}`);
        args.push(arg);
        continue;
      }

      if (last.type === "array_declarator") {
        const arg = `arg${i++}`;
        const ident = last.children[0].text;
        const array_declarator = last.children
          .slice(1)
          .map(n => n.text)
          .join("");
        const type = parameterDeclarationNode.children
          .slice(0, last_idx)
          .map(n => n.text)
          .join(" ");
        console.log("IDENT", ident, "TYPE", type, "ARRAY DECLARATOR", array_declarator);
        decls.push(`${type} *${arg}`);
        args.push(arg);
        continue;
      }

      // function pointer
      if (last.type === "function_declarator") {
        console.log("FUNCTION DECLARATOR", last.children);
        const return_ty = parameterDeclarationNode.children[0].text;
        // console.log("LMAO", );
        const arg = `arg${i++}`;
        const param_list = last.children[1];
        if (param_list.type !== "parameter_list") {
          throw new Error("expect param list man");
        }
        args.push(arg);
        const decl = `${return_ty} (*${arg})${param_list.text}`;
        decls.push(decl);
        continue;
      }

      assert(
        last.type === "identifier" || last.type === "pointer_declarator" || last.type === "abstract_pointer_declarator", // ||
        // last.type === "array_declarator",
        `${symbol_name} Inalid param type, but got: ` + last.type,
      );

      let type = "";
      for (let i = 0; i < last_idx; i++) {
        type += parameterDeclarationNode.children[i].text;
        type += " ";
      }

      console.log(type, "LAST TYPE lol", last.type);
      if (last.type === "pointer_declarator" || last.type === "abstract_pointer_declarator") {
        let cur = last;
        do {
          type += "*";
          assert(cur.children[0].type === "*", "Pointer declarator must have a *");
          cur = cur.children[1];
        } while (!!cur && cur.type === "pointer_declarator" && cur.children.length > 0);
      }

      const arg = `arg${i++}`;
      decls.push(`${type} ${arg}`);
      args.push(arg);
    }

    // function extractParam(node: Parser.SyntaxNode): [decl: string, arg: string] {}

    return { decls, args };
  }

  function addStub(symbolName: string, decl: string): [stub: string, symbol_name: string, types: TestInfo] {
    assert(decl.includes("UV_EXTERN"), "Must include UV_EXTERN: \n" + decl);

    const types = extractParameterTypes(decl);

    // For stub generation, we need semicolons but no initialization
    const stub_types = { ...types };
    stub_types.decls = stub_types.decls.map(d => d + ";");
    if (stub_types.args.length === 1 && stub_types.args[0] === "void") {
      stub_types.decls = [];
      stub_types.args = [];
    }

    // For test plugin generation, we need initialization
    if (types.args.length === 1 && types.args[0] === "void") {
      types.decls = [];
      types.args = [];
    } else {
      types.decls = types.decls.map(d => {
        if (d.includes("argv") || d.includes("argc")) {
          return d.trim() + ";";
        }

        // Initialize function pointers and multi-pointers to NULL, everything else to {0}
        if (d.includes("**") || d.includes("(*") || d.includes("_cb ")) {
          return d + " = NULL;";
        }

        return d + " = {0};";
      });
    }

    const decl_without_semicolon = decl.replaceAll(";", "").trim();
    console.log(decl_without_semicolon);

    const contents = `${decl_without_semicolon} {
  __bun_throw_not_implemented("${symbolName}");
  __builtin_unreachable();
}`;

    // await Bun.write(stubPath, contents);
    return [contents, symbolName, types];
  }

  function parseOutput(line: string): { filename: string; lineNumber: number; rest: string } | null {
    // Match pattern: filename:linenumber:rest
    const match = line.match(/^([^:]+):(\d+):(.*)$/);

    if (!match) {
      return null;
    }

    return {
      filename: match[1],
      lineNumber: parseInt(match[2], 10) - 1,
      rest: match[3],
    };
  }

  return addStub(symbol_name, rest);
}

// const symbols = ["uv_async_init"];

if (!Bun.which("rg")) {
  console.error("You need ripgrep bro");
  process.exit(1);
}

for (const symbol of symbols) {
  await generate(symbol);
}

let parts = await Promise.all(symbols.map(s => generate(s)));

const final_contents = `// GENERATED CODE - DO NOT MODIFY BY HAND
#include "uv-posix-polyfills.h"


#if OS(LINUX) || OS(DARWIN)
${parts.map(([stub, _]) => stub).join("\n\n")}
#endif

`;

await Bun.write(join(import.meta.dir, "../", "uv-posix-stubs.c"), final_contents);
if (Bun.which("clang-format")) {
  await Bun.$`clang-format -i ${join(import.meta.dir, "../", "uv-posix-stubs.c")}`;
}

const test_plugin_contents = ` // GENERATED CODE ... NO TOUCHY!!
  #include <node_api.h>

#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <uv.h>

napi_value call_uv_func(napi_env env, napi_callback_info info) {
  napi_status status;

  size_t argc = 2;
  napi_value args[2];
  status = napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to parse arguments");
    return NULL;
  }

  if (argc < 1) {
    napi_throw_error(env, NULL, "Wrong number of arguments");
    return NULL;
  }

  napi_value arg = args[0];
  char buffer[256];
  size_t buffer_size = sizeof(buffer);
  size_t copied;

  status = napi_get_value_string_utf8(env, arg, buffer, buffer_size, &copied);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to get string value");
    return NULL;
  }

  buffer[copied] = '\\0';
  printf("Got string: %s\\n", buffer);

${parts
  .map(([_, symbol_name, types]) => {
    if (test_skipped.includes(symbol_name)) return "";
    return `
if (strcmp(buffer, "${symbol_name}") == 0) {
  ${types.decls.join("\n")}

  ${symbol_name}(${types.args.join(", ")});
  return NULL;
}
`;
  })
  .join("\n\n")}

  napi_throw_error(env, NULL, "Function not found");

  return NULL;
}
  
napi_value Init(napi_env env, napi_value exports) {
  napi_status status;
  napi_value fn_call_uv_func;

  // Register call_uv_func function
  status =
      napi_create_function(env, NULL, 0, call_uv_func, NULL, &fn_call_uv_func);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "Failed to create call_uv_func function");
    return NULL;
  }

  status = napi_set_named_property(env, exports, "callUVFunc", fn_call_uv_func);
  if (status != napi_ok) {
    napi_throw_error(env, NULL,
                     "Failed to add call_uv_func function to exports");
    return NULL;
  }

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
`;

const plugin_path_ = join(import.meta.dir, "../", "../", "../", "../", "test", "napi", "uv-stub-stuff", "plugin.c");
await Bun.write(plugin_path_, test_plugin_contents);

if (Bun.which("clang-format")) {
  await Bun.$`clang-format -i ${plugin_path_}`.quiet();
}

// for (const symbol of symbols) {
// await generate("uv_if_indextoiid");
// }

// console.log("DONE");
