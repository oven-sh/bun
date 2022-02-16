import { expect, it, describe } from "bun:test";

describe("Bun.Transpiler", () => {
  const transpiler = new Bun.Transpiler({
    loader: "tsx",
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
    },
    macro: {
      react: {
        bacon: `${import.meta.dir}/macro-check.js`,
      },
    },
    platform: "browser",
  });

  const code = `import { useParams } from "remix";
  import type { LoaderFunction, ActionFunction } from "remix";
  import { type xx } from 'mod';
  import { type xx as yy } from 'mod';
  import { type 'xx' as yy } from 'mod';
  import { type if as yy } from 'mod';
  import React, { type ReactNode, Component as Romponent, Component } from 'react';

  
  export const loader: LoaderFunction = async ({
    params
  }) => {
    console.log(params.postId);
  };
  
  export const action: ActionFunction = async ({
    params
  }) => {
    console.log(params.postId);
  };
  
  export default function PostRoute() {
    const params = useParams();
    console.log(params.postId);
  }





  `;

  describe("scanImports", () => {
    it("reports import paths, excluding types", () => {
      const imports = transpiler.scanImports(code, "tsx");
      expect(imports.filter(({ path }) => path === "remix")).toHaveLength(1);
      expect(imports.filter(({ path }) => path === "mod")).toHaveLength(0);
      expect(imports.filter(({ path }) => path === "react")).toHaveLength(1);
      expect(imports).toHaveLength(2);
    });
  });

  describe("parser", () => {
    const parsed = (code, trim = true, autoExport = false) => {
      if (autoExport) {
        code = "export default (" + code + ")";
      }

      var out = transpiler.transformSync(code, "js");
      if (autoExport && out.startsWith("export default ")) {
        out = out.substring("export default ".length);
      }

      if (trim) {
        out = out.trim();

        if (out.endsWith(";")) {
          out = out.substring(0, out.length - 1);
        }

        return out.trim();
      }

      return out;
    };

    const expectPrinted = (code, out) => {
      expect(parsed(code, true, true)).toBe(out);
    };

    const expectPrinted_ = (code, out) => {
      expect(parsed(code, !out.endsWith(";\n"), false)).toBe(out);
    };

    const expectParseError = (code, message) => {
      try {
        parsed(code, false, false);
      } catch (er) {
        expect(er.message).toBe(message);
        return;
      }

      throw new Error("Expected parse error for code\n\t" + code);
    };

    // it("arrays", () => {
    //   expectPrinted("[]", "[]");
    //   expectPrinted("[,]", "[,]");
    //   expectPrinted("[1]", "[1]");
    //   expectPrinted("[1,]", "[1]");
    //   expectPrinted("[,1]", "[, 1]");
    //   expectPrinted("[1,2]", "[1, 2]");
    //   expectPrinted("[,1,2]", "[, 1, 2]");
    //   expectPrinted("[1,,2]", "[1, , 2]");
    //   expectPrinted("[1,2,]", "[1, 2]");
    //   expectPrinted("[1,2,,]", "[1, 2, ,]");
    // });

    // it("exponentiation", () => {
    //   expectPrinted("(delete x) ** 0", "(delete x) ** 0");
    //   expectPrinted("(delete x.prop) ** 0", "(delete x.prop) ** 0");
    //   expectPrinted("(delete x[0]) ** 0", "(delete x[0]) ** 0");

    //   // remember: we are printing from export default
    //   expectPrinted("(delete x?.prop) ** 0", "(delete (x?.prop)) ** 0");

    //   expectPrinted("(void x) ** 0", "(void x) ** 0");
    //   expectPrinted("(typeof x) ** 0", "(typeof x) ** 0");
    //   expectPrinted("(+x) ** 0", "(+x) ** 0");
    //   expectPrinted("(-x) ** 0", "(-x) ** 0");
    //   expectPrinted("(~x) ** 0", "(~x) ** 0");
    //   expectPrinted("(!x) ** 0", "(!x) ** 0");
    //   expectPrinted("(await x) ** 0", "(await x) ** 0");
    //   expectPrinted("(await -x) ** 0", "(await -x) ** 0");

    //   expectPrinted("--x ** 2", "--x ** 2");
    //   expectPrinted("++x ** 2", "++x ** 2");
    //   expectPrinted("x-- ** 2", "x-- ** 2");
    //   expectPrinted("x++ ** 2", "x++ ** 2");

    //   expectPrinted("(-x) ** 2", "(-x) ** 2");
    //   expectPrinted("(+x) ** 2", "(+x) ** 2");
    //   expectPrinted("(~x) ** 2", "(~x) ** 2");
    //   expectPrinted("(!x) ** 2", "(!x) ** 2");
    //   expectPrinted("(-1) ** 2", "(-1) ** 2");
    //   expectPrinted("(+1) ** 2", "1 ** 2");
    //   expectPrinted("(~1) ** 2", "(~1) ** 2");
    //   expectPrinted("(!1) ** 2", "false ** 2");
    //   expectPrinted("(void x) ** 2", "(void x) ** 2");
    //   expectPrinted("(delete x) ** 2", "(delete x) ** 2");
    //   expectPrinted("(typeof x) ** 2", "(typeof x) ** 2");
    //   expectPrinted("undefined ** 2", "undefined ** 2");

    //   expectParseError("-x ** 2", "Unexpected **");
    //   expectParseError("+x ** 2", "Unexpected **");
    //   expectParseError("~x ** 2", "Unexpected **");
    //   expectParseError("!x ** 2", "Unexpected **");
    //   expectParseError("void x ** 2", "Unexpected **");
    //   expectParseError("delete x ** 2", "Unexpected **");
    //   expectParseError("typeof x ** 2", "Unexpected **");

    //   expectParseError("-x.y() ** 2", "Unexpected **");
    //   expectParseError("+x.y() ** 2", "Unexpected **");
    //   expectParseError("~x.y() ** 2", "Unexpected **");
    //   expectParseError("!x.y() ** 2", "Unexpected **");
    //   expectParseError("void x.y() ** 2", "Unexpected **");
    //   expectParseError("delete x.y() ** 2", "Unexpected **");
    //   expectParseError("typeof x.y() ** 2", "Unexpected **");

    //   expectParseError("delete x ** 0", "Unexpected **");
    //   expectParseError("delete x.prop ** 0", "Unexpected **");
    //   expectParseError("delete x[0] ** 0", "Unexpected **");
    //   expectParseError("delete x?.prop ** 0", "Unexpected **");
    //   expectParseError("void x ** 0", "Unexpected **");
    //   expectParseError("typeof x ** 0", "Unexpected **");
    //   expectParseError("+x ** 0", "Unexpected **");
    //   expectParseError("-x ** 0", "Unexpected **");
    //   expectParseError("~x ** 0", "Unexpected **");
    //   expectParseError("!x ** 0", "Unexpected **");
    //   expectParseError("await x ** 0", "Unexpected **");
    //   expectParseError("await -x ** 0", "Unexpected **");
    // });

    // it("await", () => {
    //   expectPrinted("await x", "await x");
    //   expectPrinted("await +x", "await +x");
    //   expectPrinted("await -x", "await -x");
    //   expectPrinted("await ~x", "await ~x");
    //   expectPrinted("await !x", "await !x");
    //   expectPrinted("await --x", "await --x");
    //   expectPrinted("await ++x", "await ++x");
    //   expectPrinted("await x--", "await x--");
    //   expectPrinted("await x++", "await x++");
    //   expectPrinted("await void x", "await void x");
    //   expectPrinted("await typeof x", "await typeof x");
    //   expectPrinted("await (x * y)", "await (x * y)");
    //   expectPrinted("await (x ** y)", "await (x ** y)");

    //   expectPrinted_(
    //     "async function f() { await delete x }",
    //     "async function f() {\n  await delete x;\n}"
    //   );

    //   // expectParseError(
    //   //   "await delete x",
    //   //   "Delete of a bare identifier cannot be used in an ECMAScript module"
    //   // );
    // });

    it.only("decls", () => {
      // expectParseError("var x = 0", "");
      // expectParseError("let x = 0", "");
      // expectParseError("const x = 0", "");
      // expectParseError("for (var x = 0;;) ;", "");
      // expectParseError("for (let x = 0;;) ;", "");
      // expectParseError("for (const x = 0;;) ;", "");

      // expectParseError("for (var x in y) ;", "");
      // expectParseError("for (let x in y) ;", "");
      // expectParseError("for (const x in y) ;", "");
      // expectParseError("for (var x of y) ;", "");
      // expectParseError("for (let x of y) ;", "");
      // expectParseError("for (const x of y) ;", "");

      // expectParseError("var x", "");
      // expectParseError("let x", "");
      expectParseError("const x", 'The constant "x" must be initialized');
      expectParseError("const {}", "This constant must be initialized");
      expectParseError("const []", "This constant must be initialized");
      // expectParseError("for (var x;;) ;", "");
      // expectParseError("for (let x;;) ;", "");
      expectParseError(
        "for (const x;;) ;",
        'The constant "x" must be initialized'
      );
      expectParseError(
        "for (const {};;) ;",
        "This constant must be initialized"
      );
      expectParseError(
        "for (const [];;) ;",
        "This constant must be initialized"
      );

      // Make sure bindings are visited during parsing
      expectPrinted_("var {[x]: y} = {}", "var { [x]: y } = {}");
      expectPrinted_("var {...x} = {}", "var { ...x } = {}");

      // Test destructuring patterns
      expectPrinted_("var [...x] = []", "var [...x] = []");
      expectPrinted_("var {...x} = {}", "var { ...x } = {}");
      console.log("before");

      expectPrinted_(
        "export var foo = ([...x] = []) => {}",
        "export var foo = ([...x] = []) => {\n}"
      );

      expectPrinted_(
        "export var foo = ({...x} = {}) => {}",
        "export var foo = ({ ...x } = {}) => {\n}"
      );

      expectParseError("var [...x,] = []", 'Unexpected "," after rest pattern');
      expectParseError("var {...x,} = {}", 'Unexpected "," after rest pattern');
      expectParseError(
        "export default function() { return ([...x,] = []) => {} }",
        "Unexpected trailing comma after rest element"
      );
      expectParseError(
        "({...x,} = {}) => {}",
        "Unexpected trailing comma after rest element"
      );

      expectPrinted_("[b, ...c] = d", "[b, ...c] = d");
      expectPrinted_("([b, ...c] = d)", "[b, ...c] = d");
      expectPrinted_("({b, ...c} = d)", "({b, ...c } = d)");
      expectPrinted_("({a = b} = c)", "({a = b } = c)");
      expectPrinted_("({a: b = c} = d)", "({a: b = c } = d)");
      expectPrinted_("({a: b.c} = d)", "({a: b.c } = d)");
      expectPrinted_("[a = {}] = b", "[a = {}] = b");
      expectPrinted_("[[...a, b].x] = c", "[[...a, b].x] = c");
      expectPrinted_("[{...a, b}.x] = c", "[{...a, b }.x] = c");
      expectPrinted_("({x: [...a, b].x} = c)", "({x: [...a, b].x } = c)");
      expectPrinted_("({x: {...a, b}.x} = c)", "({x: {...a, b }.x } = c)");
      expectPrinted_("[x = [...a, b]] = c", "[x = [...a, b]] = c");
      expectPrinted_("[x = {...a, b}] = c", "[x = {...a, b }] = c");
      expectPrinted_("({x = [...a, b]} = c)", "({x = [...a, b] } = c)");
      expectPrinted_("({x = {...a, b}} = c)", "({ x = { ...a, b } } = c)");

      expectPrinted_("(x = y)", "x = y");
      expectPrinted_("([] = [])", "[] = []");
      expectPrinted_("({} = {})", "({} = {})");
      expectPrinted_("([[]] = [[]])", "[[]] = [[]]");
      expectPrinted_("({x: {}} = {x: {}})", "({ x: {} } = { x: {} })");
      expectPrinted_("(x) = y", "x = y");
      expectParseError("([]) = []", "Invalid assignment target");
      expectParseError("({}) = {}", "Invalid assignment target");
      expectParseError("[([])] = [[]]", "Invalid assignment target");
      expectParseError("({x: ({})} = {x: {}})", "Invalid assignment target");
      expectParseError("(([]) = []) => {}", "Invalid binding pattern");
      expectParseError("(({}) = {}) => {}", "Invalid binding pattern");
      expectParseError(
        "function f(([]) = []) {}",
        'Expected identifier but found "("\n'
      );
      expectParseError(
        "function f(({}) = {}) {}",
        'Expected identifier but found "("\n'
      );

      expectPrinted_("for (x in y) ;", "for (x in y)\n  ;\n");
      expectPrinted_("for ([] in y) ;", "for ([] in y)\n  ;\n");
      expectPrinted_("for ({} in y) ;", "for ({} in y)\n  ;\n");
      expectPrinted_("for ((x) in y) ;", "for (x in y)\n  ;\n");
      expectParseError("for (([]) in y) ;", "Invalid assignment target\n");
      expectParseError("for (({}) in y) ;", "Invalid assignment target\n");

      expectPrinted_("for (x of y) ;", "for (x of y)\n  ;\n");
      expectPrinted_("for ([] of y) ;", "for ([] of y)\n  ;\n");
      expectPrinted_("for ({} of y) ;", "for ({} of y)\n  ;\n");
      expectPrinted_("for ((x) of y) ;", "for (x of y)\n  ;\n");
      expectParseError("for (([]) of y) ;", "Invalid assignment target\n");
      expectParseError("for (({}) of y) ;", "Invalid assignment target\n");

      expectParseError(
        "[[...a, b]] = c",
        'Unexpected "," after rest pattern\n'
      );
      expectParseError(
        "[{...a, b}] = c",
        'Unexpected "," after rest pattern\n'
      );
      expectParseError(
        "({x: [...a, b]} = c)",
        'Unexpected "," after rest pattern\n'
      );
      expectParseError(
        "({x: {...a, b}} = c)",
        'Unexpected "," after rest pattern\n'
      );
      expectParseError("[b, ...c,] = d", 'Unexpected "," after rest pattern\n');
      expectParseError(
        "([b, ...c,] = d)",
        'Unexpected "," after rest pattern\n'
      );
      expectParseError(
        "({b, ...c,} = d)",
        'Unexpected "," after rest pattern\n'
      );
      expectParseError("({a = b})", 'Unexpected "="\n');
      expectParseError("({x = {a = b}} = c)", 'Unexpected "="\n');
      expectParseError("[a = {b = c}] = d", 'Unexpected "="\n');

      expectPrinted_(
        "for ([{a = {}}] in b) {}",
        "for ([{ a = {} }] in b) {\n}\n"
      );
      expectPrinted_(
        "for ([{a = {}}] of b) {}",
        "for ([{ a = {} }] of b) {\n}\n"
      );
      expectPrinted_("for ({a = {}} in b) {}", "for ({ a = {} } in b) {\n}\n");
      expectPrinted_("for ({a = {}} of b) {}", "for ({ a = {} } of b) {\n}\n");

      expectParseError("({a = {}} in b)", 'Unexpected "="\n');
      expectParseError("[{a = {}}]\nof()", 'Unexpected "="\n');
      expectParseError(
        "for ([...a, b] in c) {}",
        'Unexpected "," after rest pattern\n'
      );
      expectParseError(
        "for ([...a, b] of c) {}",
        'Unexpected "," after rest pattern\n'
      );
    });

    it("regexp", () => {
      expectPrinted("/x/g", "/x/g");
      expectPrinted("/x/i", "/x/i");
      expectPrinted("/x/m", "/x/m");
      expectPrinted("/x/s", "/x/s");
      expectPrinted("/x/u", "/x/u");
      expectPrinted("/x/y", "/x/y");
      expectPrinted("/gimme/g", "/gimme/g");
      expectPrinted("/gimgim/g", "/gimgim/g");

      expectParseError(
        "/x/msuygig",
        'Duplicate flag "g" in regular expression'
      );
    });

    it("identifier escapes", () => {
      expectPrinted_("var _\u0076\u0061\u0072", "var _var");
      // expectParseError(
      //   "var \u0076\u0061\u0072",
      //   "Expected identifier but found \u0076\u0061\u0072"
      // );
      // expectParseError(t, "\\u0076\\u0061\\u0072 foo", "<stdin>: ERROR: Unexpected \"\\\\u0076\\\\u0061\\\\u0072\"\n")

      expectPrinted_("foo._\u0076\u0061\u0072", "foo._var");
      expectPrinted_("foo.\u0076\u0061\u0072", "foo.var");

      // expectParseError(t, "\u200Ca", "<stdin>: ERROR: Unexpected \"\\u200c\"\n")
      // expectParseError(t, "\u200Da", "<stdin>: ERROR: Unexpected \"\\u200d\"\n")
    });
  });

  describe("simplification", () => {
    describe("type coercions", () => {
      const dead = `
      if ("") {
        TEST_FAIL
      }

      if (false) {
        TEST_FAIL
      }

      if (0) {
        TEST_FAIL
      }

      if (void 0) {
        TEST_FAIL
      }

      if (null) {
        TEST_FAIL
      }

      var should_be_true = typeof "" === "string" || false
      var should_be_false = typeof "" !== "string" && TEST_FAIL;
      var should_be_false_2 = typeof true === "string" && TEST_FAIL;
      var should_be_false_3 = typeof false === "string" && TEST_FAIL;
      var should_be_false_4 = typeof 123n === "string" && TEST_FAIL;
      var should_be_false_5 = typeof function(){} === "string" && TEST_FAIL;
      var should_be_kept = typeof globalThis.BACON  === "string" && TEST_OK;
      var should_be_kept_1 = typeof TEST_OK  === "string";

      var should_be_kept_2 = TEST_OK ?? true;
      var should_be_kept_4 = { "TEST_OK": true } ?? TEST_FAIL;
      var should_be_false_6 = false ?? TEST_FAIL;
      var should_be_true_7 = true ?? TEST_FAIL;
    `;
      const out = transpiler.transformSync(dead);

      for (let line of out.split("\n")) {
        it(line, () => {
          if (line.includes("should_be_kept")) {
            expect(line.includes("TEST_OK")).toBe(true);
          }

          if (line.includes("should_be_false")) {
            if (!line.includes("= false"))
              throw new Error(`Expected false in "${line}"`);
            expect(line.includes("= false")).toBe(true);
          }

          if (line.includes("TEST_FAIL")) {
            throw new Error(`"${line}"\n\tshould not contain TEST_FAIL`);
          }
        });
      }
    });
  });

  describe("scan", () => {
    it("reports all export names", () => {
      const { imports, exports } = transpiler.scan(code);

      expect(exports[0]).toBe("action");
      expect(exports[2]).toBe("loader");
      expect(exports[1]).toBe("default");
      expect(exports).toHaveLength(3);

      expect(imports.filter(({ path }) => path === "remix")).toHaveLength(1);
      expect(imports.filter(({ path }) => path === "mod")).toHaveLength(0);
      expect(imports.filter(({ path }) => path === "react")).toHaveLength(1);
      expect(imports).toHaveLength(2);
    });
  });

  describe("transform", () => {
    it("supports macros", async () => {
      const out = await transpiler.transform(`
        import {keepSecondArgument} from 'macro:${
          import.meta.dir
        }/macro-check.js';

        export default keepSecondArgument("Test failed", "Test passed");
        export function otherNamesStillWork() {}
      `);
      expect(out.includes("Test failed")).toBe(false);
      expect(out.includes("Test passed")).toBe(true);

      // ensure both the import and the macro function call are removed
      expect(out.includes("keepSecondArgument")).toBe(false);
      expect(out.includes("otherNamesStillWork")).toBe(true);
    });

    it("sync supports macros", () => {
      const out = transpiler.transformSync(`
        import {keepSecondArgument} from 'macro:${
          import.meta.dir
        }/macro-check.js';

        export default keepSecondArgument("Test failed", "Test passed");
        export function otherNamesStillWork() {

        }
      `);
      expect(out.includes("Test failed")).toBe(false);
      expect(out.includes("Test passed")).toBe(true);

      expect(out.includes("keepSecondArgument")).toBe(false);
      expect(out.includes("otherNamesStillWork")).toBe(true);
    });

    const importLines = [
      "import {createElement, bacon} from 'react';",
      "import {bacon, createElement} from 'react';",
    ];
    describe("sync supports macros remap", () => {
      for (let importLine of importLines) {
        it(importLine, () => {
          var thisCode = `
          ${importLine}
          
          export default bacon("Test failed", "Test passed");
          export function otherNamesStillWork() {
            return createElement("div");
          }
          
        `;
          var out = transpiler.transformSync(thisCode);
          try {
            expect(out.includes("Test failed")).toBe(false);
            expect(out.includes("Test passed")).toBe(true);

            expect(out.includes("bacon")).toBe(false);
            expect(out.includes("createElement")).toBe(true);
          } catch (e) {
            console.log("Failing code:\n\n" + out + "\n");
            throw e;
          }
        });
      }
    });

    it("macro remap removes import statement if its the only used one", () => {
      const out = transpiler.transformSync(`
        import {bacon} from 'react';

        export default bacon("Test failed", "Test passed");
      `);

      expect(out.includes("Test failed")).toBe(false);
      expect(out.includes("Test passed")).toBe(true);

      expect(out.includes("bacon")).toBe(false);
      expect(out.includes("import")).toBe(false);
    });

    it("removes types", () => {
      expect(code.includes("mod")).toBe(true);
      expect(code.includes("xx")).toBe(true);
      expect(code.includes("ActionFunction")).toBe(true);
      expect(code.includes("LoaderFunction")).toBe(true);
      expect(code.includes("ReactNode")).toBe(true);
      expect(code.includes("React")).toBe(true);
      expect(code.includes("Component")).toBe(true);
      const out = transpiler.transformSync(code);

      expect(out.includes("ActionFunction")).toBe(false);
      expect(out.includes("LoaderFunction")).toBe(false);
      expect(out.includes("mod")).toBe(false);
      expect(out.includes("xx")).toBe(false);
      expect(out.includes("ReactNode")).toBe(false);
      const { exports } = transpiler.scan(out);
      exports.sort();

      expect(exports[0]).toBe("action");
      expect(exports[2]).toBe("loader");
      expect(exports[1]).toBe("default");
      expect(exports).toHaveLength(3);
    });
  });
});
