import { describe, expect, test } from "bun:test";
import { MockTestController, MockWorkspaceFolder } from "./vscode-types.mock";
import "./vscode.mock";
import { makeTestController, makeWorkspaceFolder } from "./vscode.mock";

const { BunTestController } = await import("../bun-test-controller");

const mockTestController: MockTestController = makeTestController();
const mockWorkspaceFolder: MockWorkspaceFolder = makeWorkspaceFolder("/test/workspace");

const controller = new BunTestController(mockTestController, mockWorkspaceFolder, true);
const internal = controller._internal;

const { expandEachTests, parseTestBlocks, getBraceDepth } = internal;

describe("BunTestController (static file parser)", () => {
  describe("expandEachTests", () => {
    describe("$variable syntax", () => {
      test("should not expand $variable patterns (Bun behavior)", () => {
        const content = `test.each([
          { a: 1, b: 2, expected: 3 },
          { a: 5, b: 5, expected: 10 }
        ])('$a + $b = $expected', ({ a, b, expected }) => {})`;

        const result = expandEachTests("test.each([", "$a + $b = $expected", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$a + $b = $expected");
      });

      test("should not expand string values with quotes", () => {
        const content = `test.each([
          { name: "Alice", city: "NYC" },
          { name: "Bob", city: "LA" }
        ])('$name from $city', ({ name, city }) => {})`;

        const result = expandEachTests("test.each([", "$name from $city", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$name from $city");
      });

      test("should not expand nested property access", () => {
        const content = `test.each([
          { user: { name: "Alice", profile: { city: "NYC" } } },
          { user: { name: "Bob", profile: { city: "LA" } } }
        ])('$user.name from $user.profile.city', ({ user }) => {})`;

        const result = expandEachTests("test.each([", "$user.name from $user.profile.city", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$user.name from $user.profile.city");
      });

      test("should not expand array indexing", () => {
        const content = `test.each([
          { users: [{ name: "Alice" }, { name: "Bob" }] },
          { users: [{ name: "Carol" }, { name: "Dave" }] }
        ])('first user: $users.0.name', ({ users }) => {})`;

        const result = expandEachTests("test.each([", "first user: $users.0.name", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("first user: $users.0.name");
      });

      test("should return template as-is for missing properties", () => {
        const content = `test.each([
          { a: 1 },
          { a: 2 }
        ])('$a and $missing', ({ a }) => {})`;

        const result = expandEachTests("test.each([", "$a and $missing", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$a and $missing");
      });

      test("should handle edge cases with special identifiers", () => {
        const content = `test.each([
          { _valid: "ok", $dollar: "yes", _123mix: "mixed" }
        ])('$_valid | $$dollar | $_123mix', (obj) => {})`;

        const result = expandEachTests("test.each([", "$_valid | $$dollar | $_123mix", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$_valid | $$dollar | $_123mix");
      });

      test("should handle invalid identifiers as literals", () => {
        const content = `test.each([
          { valid: "test" }
        ])('$valid | $123invalid | $has-dash', (obj) => {})`;

        const result = expandEachTests("test.each([", "$valid | $123invalid | $has-dash", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$valid | $123invalid | $has-dash");
      });
    });

    describe("% formatters", () => {
      test("should handle %i for integers", () => {
        const content = `test.each([
          [1, 2, 3],
          [5, 5, 10]
        ])('%i + %i = %i', (a, b, expected) => {})`;

        const result = expandEachTests("test.each([", "%i + %i = %i", content, 0, "test", 1);

        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("1 + 2 = 3");
        expect(result[1].name).toBe("5 + 5 = 10");
      });

      test("should handle %s for strings", () => {
        const content = `test.each([
          ["hello", "world"],
          ["foo", "bar"]
        ])('%s %s', (a, b) => {})`;

        const result = expandEachTests("test.each([", "%s %s", content, 0, "test", 1);

        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("hello world");
        expect(result[1].name).toBe("foo bar");
      });

      test("should handle %f and %d for numbers", () => {
        const content = `test.each([
          [1.5, 2.7],
          [3.14, 2.71]
        ])('%f and %d', (a, b) => {})`;

        const result = expandEachTests("test.each([", "%f and %d", content, 0, "test", 1);

        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("1.5 and 2.7");
        expect(result[1].name).toBe("3.14 and 2.71");
      });

      test("should handle %o and %j for objects", () => {
        const content = `test.each([
          [{ a: 1 }, { b: 2 }]
        ])('%o and %j', (obj1, obj2) => {})`;

        const result = expandEachTests("test.each([", "%o and %j", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("%o and %j");
      });

      test("should handle %# for index", () => {
        const content = `test.each([
          [1, 2],
          [3, 4],
          [5, 6]
        ])('Test #%#: %i + %i', (a, b) => {})`;

        const result = expandEachTests("test.each([", "Test #%#: %i + %i", content, 0, "test", 1);

        expect(result).toHaveLength(3);
        expect(result[0].name).toBe("Test #1: 1 + 2");
        expect(result[1].name).toBe("Test #2: 3 + 4");
        expect(result[2].name).toBe("Test #3: 5 + 6");
      });

      test("should handle %% for literal percent", () => {
        const content = `test.each([
          [50],
          [100]
        ])('%i%% complete', (percent) => {})`;

        const result = expandEachTests("test.each([", "%i%% complete", content, 0, "test", 1);

        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("50% complete");
        expect(result[1].name).toBe("100% complete");
      });
    });

    describe("describe.each", () => {
      test("should work with describe.each", () => {
        const content = `describe.each([
          { module: "fs", method: "readFile" },
          { module: "path", method: "join" }
        ])('$module module', ({ module, method }) => {})`;

        const result = expandEachTests("describe.each([", "$module module", content, 0, "describe", 1);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$module module");
        expect(result[0].type).toBe("describe");
      });
    });

    describe("error handling", () => {
      test("should handle non-.each tests", () => {
        const result = expandEachTests("test", "regular test", "test('regular test', () => {})", 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("regular test");
      });

      test("should handle malformed JSON", () => {
        const content = `test.each([
          { invalid json }
        ])('test', () => {})`;

        const result = expandEachTests("test.each([", "test", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("test");
      });

      test("should handle non-array values", () => {
        const content = `test.each({ not: "array" })('test', () => {})`;

        const result = expandEachTests("test.each([", "test", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("test");
      });
    });

    describe("mixed formatters", () => {
      test("should handle both $ and % in objects", () => {
        const content = `test.each([
          { name: "Test", index: 0 }
        ])('$name #%#', (obj) => {})`;

        const result = expandEachTests("test.each([", "$name #%#", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$name #%#");
      });
    });

    describe("edge cases", () => {
      test("should handle complex nested objects", () => {
        const content = `test.each([
          { 
            user: { 
              profile: { 
                address: { 
                  city: "NYC", 
                  coords: { lat: 40.7128, lng: -74.0060 } 
                } 
              } 
            } 
          }
        ])('User from $user.profile.address.city at $user.profile.address.coords.lat', ({ user }) => {})`;

        const result = expandEachTests(
          "test.each([",
          "User from $user.profile.address.city at $user.profile.address.coords.lat",
          content,
          0,
          "test",
          1,
        );

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("User from $user.profile.address.city at $user.profile.address.coords.lat");
      });

      test("should handle arrays with inline comments", () => {
        const content = `test.each([
          { a: 1 }, // first test
          { a: 2 }, // second test
          // { a: 3 }, // commented out test
          { a: 4 } /* final test */
        ])('test $a', ({ a }) => {})`;

        const result = expandEachTests("test.each([", "test $a", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("test $a");
      });

      test("should handle arrays with multiline comments", () => {
        const content = `test.each([
          { name: "test1" },
          /* This is a
             multiline comment
             that spans several lines */
          { name: "test2" },
          /**
           * JSDoc style comment
           * with multiple lines
           */
          { name: "test3" }
        ])('$name', ({ name }) => {})`;

        const result = expandEachTests("test.each([", "$name", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("$name");
      });

      test("should handle malformed array syntax gracefully", () => {
        const content = `test.each([
          { a: 1 },
          { a: 2,,, }, // extra commas
          { a: 3, }, // trailing comma
          { a: 4 },,, // extra trailing commas
        ])('test $a', ({ a }) => {})`;

        const result = expandEachTests("test.each([", "test $a", content, 0, "test", 1);

        expect(result.length).toBeGreaterThanOrEqual(1);
      });

      test("should handle strings with comment-like content", () => {
        const content = `test.each([
          { comment: "// this is not a comment" },
          { comment: "/* neither is this */" },
          { url: "https://example.com/path" }
        ])('Test: $comment $url', (data) => {})`;

        const result = expandEachTests("test.each([", "Test: $comment $url", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Test: $comment $url");
      });

      test("should handle special characters in strings", () => {
        const content = `test.each([
          { char: "\\n" },
          { char: "\\t" },
          { char: "\\"" },
          { char: "\\'" },
          { char: "\\\\" },
          { char: "\`" }
        ])('Special char: $char', ({ char }) => {})`;

        const result = expandEachTests("test.each([", "Special char: $char", content, 0, "test", 1);

        expect(result.length).toBeGreaterThanOrEqual(1);
      });

      test("should handle empty arrays", () => {
        const content = `test.each([])('should handle empty', () => {})`;

        const result = expandEachTests("test.each([", "should handle empty", content, 0, "test", 1);

        expect(result).toHaveLength(0);
      });

      test("should handle undefined and null values", () => {
        const content = `test.each([
          { value: undefined },
          { value: null },
          { value: false },
          { value: 0 },
          { value: "" }
        ])('Value: $value', ({ value }) => {})`;

        const result = expandEachTests("test.each([", "Value: $value", content, 0, "test", 1);

        if (result.length === 1) {
          expect(result[0].name).toBe("Value: $value");
        } else {
          expect(result).toHaveLength(5);
          expect(result[0].name).toBe("Value: undefined");
          expect(result[1].name).toBe("Value: null");
          expect(result[2].name).toBe("Value: false");
          expect(result[3].name).toBe("Value: 0");
          expect(result[4].name).toBe("Value: ");
        }
      });

      test("should handle circular references gracefully", () => {
        const content = `test.each([
          { a: { b: "[Circular]" } },
          { a: { b: { c: "[Circular]" } } }
        ])('Circular: $a.b', ({ a }) => {})`;

        const result = expandEachTests("test.each([", "Circular: $a.b", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Circular: $a.b");
      });

      test("should handle very long property paths", () => {
        const content = `test.each([
          { 
            a: { 
              b: { 
                c: { 
                  d: { 
                    e: { 
                      f: { 
                        g: "deeply nested" 
                      } 
                    } 
                  } 
                } 
              } 
            } 
          }
        ])('Value: $a.b.c.d.e.f.g', (data) => {})`;

        const result = expandEachTests("test.each([", "Value: $a.b.c.d.e.f.g", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Value: $a.b.c.d.e.f.g");
      });

      test("should handle syntax errors in array", () => {
        const content = `test.each([
          { a: 1 }
          { a: 2 } // missing comma
          { a: 3 }
        ])('test $a', ({ a }) => {})`;

        const result = expandEachTests("test.each([", "test $a", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("test $a");
      });

      test("should handle arrays with trailing commas", () => {
        const content = `test.each([
          { a: 1 },
          { a: 2 },
        ])('test $a', ({ a }) => {})`;

        const result = expandEachTests("test.each([", "test $a", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("test $a");
      });

      test("should handle mixed data types in arrays", () => {
        const content = `test.each([
          ["string", 123, true, null, undefined],
          [{ obj: true }, [1, 2, 3], new Date("2024-01-01")]
        ])('test %s %i %s %s %s', (...args) => {})`;

        const result = expandEachTests("test.each([", "test %s %i %s %s %s", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("test %s %i %s %s %s");
      });

      test("should handle regex-like strings", () => {
        const content = `test.each([
          { pattern: "/^test.*$/" },
          { pattern: "\\\\d{3}-\\\\d{4}" },
          { pattern: "[a-zA-Z]+" }
        ])('Pattern: $pattern', ({ pattern }) => {})`;

        const result = expandEachTests("test.each([", "Pattern: $pattern", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Pattern: $pattern");
      });

      test("should handle invalid property access gracefully", () => {
        const content = `test.each([
          { a: { b: null } },
          { a: null },
          { },
          { a: { } }
        ])('Access: $a.b.c.d', (data) => {})`;

        const result = expandEachTests("test.each([", "Access: $a.b.c.d", content, 0, "test", 1);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Access: $a.b.c.d");
      });

      test("should handle object methods and computed properties", () => {
        const content = `test.each([
          { fn: function() {}, method() {}, arrow: () => {} },
          { ["computed"]: "value", [Symbol.for("sym")]: "symbol" }
        ])('Object with methods', (obj) => {})`;

        const result = expandEachTests("test.each([", "Object with methods", content, 0, "test", 1);

        expect(result.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe("template table", () => {
      // The names of the nodes for test.each`<body>`(<title>, () => {}).
      const rowNames = (body: string, title: string) =>
        expandEachTests(
          "test.each`",
          title,
          "test.each`" + body + "`(" + JSON.stringify(title) + ", () => {})",
          0,
          "test",
          1,
        ).map(node => node.name);
      const table = (...lines: string[]) => "\n" + lines.map(line => `  ${line}\n`).join("");

      test("should expand one test per row", () => {
        const body = table("a    | b    | expected", "${1} | ${2} | ${3}", "${4} | ${5} | ${9}");

        expect(rowNames(body, "add($a, $b) = $expected")).toEqual(["add(1, 2) = 3", "add(4, 5) = 9"]);
      });

      test("should keep the node type and position", () => {
        const content = "describe.each`\n  db\n  ${'postgres'}\n  ${'mysql'}\n`('Database $db', () => {})";

        expect(expandEachTests("describe.each`", "Database $db", content, 0, "describe", 7)).toEqual([
          { name: "Database postgres", type: "describe", line: 7, children: [], startIdx: 0 },
          { name: "Database mysql", type: "describe", line: 7, children: [], startIdx: 0 },
        ]);
      });

      test.each([
        ['"apple"', "apple"],
        ["'pear'", "pear"],
        ['""', ""],
        ["true", "true"],
        ["false", "false"],
        ["7", "7"],
        ["-1.50", "-1.5"],
        ["-0", "-0"],
        ["1e21", "1e+21"],
      ])("should print the literal %s as the runtime does", (literal, printed) => {
        expect(rowNames(table("value", "${" + literal + "}"), "[$value]")).toEqual([`[${printed}]`]);
      });

      test.each([
        "value",
        "fn(1)",
        "null",
        "undefined",
        "[1, 2]",
        "{ a: 1 }",
        "`text`",
        '"a" + "b"',
        '"a\\n"',
        "0x10",
        "10n",
        "-value",
      ])("should keep the raw title for the value %s", source => {
        expect(rowNames(table("value", "${" + source + "}"), "[$value]")).toEqual(["[$value]"]);
      });

      test("should expand when the title does not use the value that is not a literal", () => {
        const body = table("name | input", "${'one'} | ${[1]}", "${'two'} | ${fn(2)}");

        expect(rowNames(body, "case $name")).toEqual(["case one", "case two"]);
      });

      test("should use the last value of a heading that repeats", () => {
        expect(rowNames(table("a | a", "${value} | ${1}"), "row $a")).toEqual(["row 1"]);
        expect(rowNames(table("a | a", "${1} | ${value}"), "row $a")).toEqual(["row $a"]);
      });

      test.each(["$missing", "$a.length", "$a$b", "$1", "$ a", "$#", "%s $a", "%# $a", "$aé"])(
        "should keep the raw title %s",
        title => {
          expect(rowNames(table("a | b", "${1} | ${2}"), title)).toEqual([title]);
        },
      );

      test("should keep the raw title for a path or a number that is also the name of a heading", () => {
        expect(rowNames(table("a.b", "${1}"), "row $a.b")).toEqual(["row $a.b"]);
        expect(rowNames(table("1st", "${1}"), "row $1st")).toEqual(["row $1st"]);
      });

      test("should keep a $ or % that ends the title", () => {
        const body = table("a | b", "${1} | ${2}");

        expect(rowNames(body, "$a of $b%")).toEqual(["1 of 2%"]);
        expect(rowNames(body, "$a costs $")).toEqual(["1 costs $"]);
      });

      test.each([
        ["headings on the line of the backtick", "a | c\n  ${1} | ${2}\n"],
        ["a row with a missing value", table("a | c", "${1} | ${2}", "${3}")],
        ["no values", table("a | c")],
        ["a space in a heading", table("a b | c", "${1} | ${2}")],
        ["an empty heading", table("a || c", "${1} | ${2} | ${3}")],
        ["an escape in the first heading", table("a\\u0062 | c", "${1} | ${2}")],
        ["an escape in a later heading", table("c | a\\u0062", "${1} | ${2}")],
      ])("should keep the raw title for a table with %s", (_, body) => {
        expect(rowNames(body, "row $c")).toEqual(["row $c"]);
      });

      test("should read a table with CRLF line endings", () => {
        expect(rowNames("\r\n  a | b\r\n  ${1} | ${2}\r\n", "$a and $b")).toEqual(["1 and 2"]);
      });
    });
  });

  describe("parseTestBlocks", () => {
    // Node names as a tree: a node with children is { name: children }.
    const tree = (nodes: ReturnType<typeof parseTestBlocks>): unknown[] =>
      nodes.map(node => {
        const name = `${node.type} ${node.name}`;
        return node.children.length > 0 ? { [name]: tree(node.children) } : name;
      });

    test("should parse simple test blocks", () => {
      const content = `
        test("should add numbers", () => {
          expect(1 + 1).toBe(2);
        });
        
        test("should multiply numbers", () => {
          expect(2 * 3).toBe(6);
        });
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("should add numbers");
      expect(result[0].type).toBe("test");
      expect(result[1].name).toBe("should multiply numbers");
      expect(result[1].type).toBe("test");
    });

    test("should parse describe blocks with nested tests", () => {
      const content = `
        describe("Math operations", () => {
          test("addition", () => {
            expect(1 + 1).toBe(2);
          });
          
          test("subtraction", () => {
            expect(5 - 3).toBe(2);
          });
        });
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Math operations");
      expect(result[0].type).toBe("describe");
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children[0].name).toBe("addition");
      expect(result[0].children[1].name).toBe("subtraction");
    });

    test("should handle test modifiers", () => {
      const content = `
        test.skip("skipped test", () => {});
        test.todo("todo test", () => {});
        test.only("only test", () => {});
        test.failing("failing test", () => {});
        test.concurrent("concurrent test", () => {});
        test.serial("serial test", () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(6);
      expect(result[0].name).toBe("skipped test");
      expect(result[1].name).toBe("todo test");
      expect(result[2].name).toBe("only test");
      expect(result[3].name).toBe("failing test");
      expect(result[4].name).toBe("concurrent test");
      expect(result[5].name).toBe("serial test");
    });

    test("should handle conditional tests", () => {
      const content = `
        test.if(true)("conditional test", () => {});
        test.skipIf(false)("skip if test", () => {});
        test.todoIf(true)("todo if test", () => {});
        test.failingIf(true)("failing if test", () => {});
        test.concurrentIf(true)("concurrent if test", () => {});
        test.serialIf(true)("serial if test", () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(6);
      expect(result[0].name).toBe("conditional test");
      expect(result[1].name).toBe("skip if test");
      expect(result[2].name).toBe("todo if test");
      expect(result[3].name).toBe("failing if test");
      expect(result[4].name).toBe("concurrent if test");
      expect(result[5].name).toBe("serial if test");
    });

    test("should handle describe modifiers", () => {
      const content = `
        describe.concurrent("concurrent describe", () => {
          test("test in concurrent", () => {});
        });
        describe.serial("serial describe", () => {
          test("test in serial", () => {});
        });
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("concurrent describe");
      expect(result[0].type).toBe("describe");
      expect(result[0].children).toHaveLength(1);
      expect(result[1].name).toBe("serial describe");
      expect(result[1].type).toBe("describe");
      expect(result[1].children).toHaveLength(1);
    });

    test("should ignore comments", () => {
      const content = `
        // This is a comment with test("fake test", () => {})
        /* Multi-line comment
           test("another fake test", () => {})
        */
        test("real test", () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("real test");
    });

    test("should handle nested describe blocks", () => {
      const content = `
        describe("Outer", () => {
          describe("Inner", () => {
            test("deeply nested", () => {});
          });
          test("shallow test", () => {});
        });
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Outer");
      expect(result[0].children).toHaveLength(2);
      expect(result[0].children[0].name).toBe("Inner");
      expect(result[0].children[0].children).toHaveLength(1);
      expect(result[0].children[0].children[0].name).toBe("deeply nested");
      expect(result[0].children[1].name).toBe("shallow test");
    });

    test("should handle it() as alias for test()", () => {
      const content = `
        it("should work with it", () => {});
        it.skip("should skip with it", () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("should work with it");
      expect(result[0].type).toBe("test");
      expect(result[1].name).toBe("should skip with it");
    });

    test("should handle different quote types", () => {
      const content = `
        test('single quotes', () => {});
        test("double quotes", () => {});
        test(\`template literals\`, () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("single quotes");
      expect(result[1].name).toBe("double quotes");
      expect(result[2].name).toBe("template literals");
    });

    test("should handle escaped quotes in test names", () => {
      const content = `
        test("test with \\"escaped\\" quotes", () => {});
        test('test with \\'escaped\\' quotes', () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('test with "escaped" quotes');
      expect(result[1].name).toBe("test with 'escaped' quotes");
    });

    test("should handle comments within test names", () => {
      const content = `
        test("test with // comment syntax", () => {});
        test("test with /* comment */ syntax", () => {});
        test("test with URL https://example.com", () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result.length).toBeGreaterThanOrEqual(1);

      const hasCommentSyntax = result.some(r => r.name.includes("comment syntax"));
      const hasURL = result.some(r => r.name.includes("https://example.com"));

      expect(hasCommentSyntax || hasURL).toBe(true);
    });

    test("should ignore code that looks like tests in strings", () => {
      const content = `
        const str = "test('fake test', () => {})";
        const template = \`describe("fake describe", () => {})\`;
        
        // Real test
        test("real test", () => {
          const example = 'test("nested fake", () => {})';
        });
      `;

      const result = parseTestBlocks(content);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.some(r => r.name === "real test")).toBe(true);
    });

    test("should handle tests with complex modifier chains", () => {
      const content = `
        test.skip.failing("skipped failing test", () => {});
        test.only.todo("only todo test", () => {});
        describe.skip.each([1, 2])("skip each %i", (n) => {});
        it.failing.each([{a: 1}])("failing each $a", ({a}) => {});
      `;

      const result = parseTestBlocks(content);

      expect(result.length).toBeGreaterThan(0);
    });

    test("should handle weird spacing and formatting", () => {
      const content = `
        test  (  "extra spaces"  ,  ( )  =>  {  }  )  ;
        test
        (
          "multiline test"
          ,
          (
          )
          =>
          {
          }
        )
        ;
        test\t(\t"tabs"\t,\t()\t=>\t{}\t);
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("extra spaces");
      expect(result[1].name).toBe("multiline test");
      expect(result[2].name).toBe("tabs");
    });

    test("should handle test.each with complex patterns", () => {
      const content = `
        test.each([
          [1, 2, 3],
          [4, 5, 9]
        ])("when %i + %i, result should be %i", (a, b, expected) => {});
        
        describe.each([
          { db: "postgres" },
          { db: "mysql" }
        ])("Database $db", ({ db }) => {
          test("should connect", () => {});
        });
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("when 1 + 2, result should be 3");
      expect(result[0].type).toBe("test");
      expect(result[1].name).toBe("when 4 + 5, result should be 9");
      expect(result[1].type).toBe("test");
      expect(result[2].name).toBe("Database $db");
      expect(result[2].type).toBe("describe");
    });

    test("should handle Unicode and emoji in test names", () => {
      const content = `
        test("测试中文", () => {});
        test("テスト日本語", () => {});
        test("тест русский", () => {});
        test("🚀 rocket test", () => {});
        test("Test with 🎉 celebration", () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(5);
      expect(result[0].name).toBe("测试中文");
      expect(result[1].name).toBe("テスト日本語");
      expect(result[2].name).toBe("тест русский");
      expect(result[3].name).toBe("🚀 rocket test");
      expect(result[4].name).toBe("Test with 🎉 celebration");
    });

    test("should handle test names with interpolation-like syntax", () => {
      const content = `
        test("test with \${variable}", () => {});
        test("test with \$dollar", () => {});
        test("test with %percent", () => {});
        test(\`template literal test\`, () => {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(4);
      expect(result[0].name).toBe("test with ${variable}");
      expect(result[1].name).toBe("test with $dollar");
      expect(result[2].name).toBe("test with %percent");
      expect(result[3].name).toBe("template literal test");
    });

    test("should handle async/await in test definitions", () => {
      const content = `
        test("sync test", () => {});
        test("async test", async () => {});
        test("test with await", async () => {
          await something();
        });
        it("async it", async function() {});
      `;

      const result = parseTestBlocks(content);

      expect(result).toHaveLength(4);
      expect(result[0].name).toBe("sync test");
      expect(result[1].name).toBe("async test");
      expect(result[2].name).toBe("test with await");
      expect(result[3].name).toBe("async it");
    });

    test("should handle generator functions and other ES6+ syntax", () => {
      const content = `
        test("generator test", function* () {
          yield 1;
        });
        
        test.each\`
          a    | b    | expected
          \${1} | \${1} | \${2}
          \${1} | \${2} | \${3}
        \`('$a + $b = $expected', ({ a, b, expected }) => {});
      `;

      const result = parseTestBlocks(content);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].name).toBe("generator test");
    });

    test("should find tests with a template table", () => {
      const content = [
        "test.each`",
        "  a    | b    | expected",
        "  ${1} | ${2} | ${3}",
        "  ${4} | ${5} | ${9}",
        '`("add($a, $b) = $expected", ({ a, b, expected }) => {',
        "  expect(a + b).toBe(expected);",
        "});",
        "",
        "describe.each`",
        "  db",
        '  ${"postgres"}',
        '  ${"mysql"}',
        '`("Database $db", ({ db }) => {',
        "  it.each`",
        "    query",
        "    ${'select'}",
        '  `("runs $query", ({ query }) => {});',
        '  it("connects", () => {});',
        "});",
        "",
        'test("after", () => {});',
      ].join("\n");

      const result = parseTestBlocks(content);

      expect(tree(result)).toEqual([
        "test add(1, 2) = 3",
        "test add(4, 5) = 9",
        { "describe Database postgres": ["test runs select", "test connects"] },
        { "describe Database mysql": ["test runs select", "test connects"] },
        "test after",
      ]);
      expect(result.map(node => node.line)).toEqual([0, 0, 8, 8, 20]);
    });

    test("should find a template table behind modifiers", () => {
      const content = [
        "test.skip.each`\n  a\n  ${1}\n`('skipped $a', () => {});",
        "it.failing.each`\n  a\n  ${2}\n`('failing $a', () => {});",
        "describe.only.each`\n  a\n  ${3}\n`('only $a', () => {});",
        "test.skipIf(isWindows()).each`\n  a\n  ${4}\n`('conditional $a', () => {});",
      ].join("\n");

      expect(tree(parseTestBlocks(content))).toEqual([
        "test skipped 1",
        "test failing 2",
        "describe only 3",
        "test conditional 4",
      ]);
    });

    test("should keep one node with the raw title for a template table it cannot expand", () => {
      const content = [
        "test.each`",
        "  a        | b",
        "  ${first} | ${1}",
        "  ${other} | ${2}",
        '`("compares $a with $b", ({ a, b }) => {});',
        'test("after", () => {});',
      ].join("\n");

      expect(tree(parseTestBlocks(content))).toEqual(["test compares $a with $b", "test after"]);
    });

    test("should read a template table with braces and backticks in a value", () => {
      const content = [
        "test.each`",
        "  name          | input",
        "  ${'object'}   | ${{ a: { b: 1 } }}",
        "  ${'template'} | ${`x${1}`}",
        "  ${'brace'}    | ${'}'}",
        "  ${'backtick'} | ${`}\\``}",
        "`('handles $name', () => {});",
        "test('after', () => {});",
      ].join("\n");

      expect(tree(parseTestBlocks(content))).toEqual([
        "test handles object",
        "test handles template",
        "test handles brace",
        "test handles backtick",
        "test after",
      ]);
    });

    test("should format a title with escaped quotes", () => {
      const content = 'test.each`\n  a\n  ${1}\n`("says \\"$a\\"", () => {});';

      expect(tree(parseTestBlocks(content))).toEqual(['test says "1"']);
    });

    test("should put the body of describe.each under every row", () => {
      const content = [
        'describe.each([[1], [2]])("group %i", n => {',
        '  describe.each([["a"], ["b"]])("inner %s", s => {',
        '    it("leaf", () => {});',
        "  });",
        '  it("mid", () => {});',
        "});",
        'test("after", () => {});',
      ].join("\n");

      const inner = [{ "describe inner a": ["test leaf"] }, { "describe inner b": ["test leaf"] }, "test mid"];
      expect(tree(parseTestBlocks(content))).toEqual([
        { "describe group 1": inner },
        { "describe group 2": inner },
        "test after",
      ]);
    });

    test("should find a test when the argument of .each or .if has parentheses", () => {
      const content = [
        'test.each([[fn(1)], [new Date(0)]])("call %s", value => {});',
        'test.each([["a)"], ["(b"]])("string %s", value => {});',
        'test.each([[`(c\\``]])("template %s", value => {});',
        'test.skipIf(os.platform() === "win32")("posix only", () => {});',
        'test.if(isCI())("ci only", () => {});',
        'describe.skipIf(isWindows())("group", () => {',
        '  it("inner", () => {});',
        "});",
        'test("after", () => {});',
      ].join("\n");

      expect(tree(parseTestBlocks(content))).toEqual([
        "test call %s",
        "test string a)",
        "test string (b",
        "test template %s",
        "test posix only",
        "test ci only",
        { "describe group": ["test inner"] },
        "test after",
      ]);
    });

    test.each([
      ["parenthesis", '("decoy", () => {});\ntest.each([[1], [2]'],
      ["template", '("decoy", () => {});\ntest.each`[[1], [2]'],
      ["template in a parenthesis", 'test.each([[`a]])("decoy", () => {});'],
      ["value in a template", 'test.each`("decoy", () => {}); ${1'],
    ])("should not find a test behind a %s that does not end", (_, content) => {
      expect(tree(parseTestBlocks(content))).toEqual([]);
    });

    test("should find a test when a quote in the table has no partner on its line", () => {
      const content = [
        "test.each([",
        '  [/"/],',
        "  [/'/],",
        '])("quote %s", () => {});',
        'test("after", () => {});',
      ].join("\n");

      expect(tree(parseTestBlocks(content))).toEqual(["test quote %s", "test after"]);
    });

    test("should expand only a table that is an array literal of the same test", () => {
      const content = [
        'test.each(cases)("from a variable %s", value => {});',
        'test.each(shuffle([[1], [2]]))("from a call %i", value => {});',
        'test("mentions .each", () => {});',
        'test.each([[1], [2]])("literal %i", value => {});',
      ].join("\n");

      expect(tree(parseTestBlocks(content))).toEqual([
        "test from a variable %s",
        "test from a call %i",
        "test mentions .each",
        "test literal 1",
        "test literal 2",
      ]);
    });
  });

  describe("getBraceDepth", () => {
    test("should count braces correctly", () => {
      const content = "{ { } }";
      expect(getBraceDepth(content, 0, content.length)).toBe(0);
      expect(getBraceDepth(content, 0, 3)).toBe(2);
      expect(getBraceDepth(content, 0, 5)).toBe(1);
    });

    test("should ignore braces in strings", () => {
      const content = '{ "string with { braces }" }';
      expect(getBraceDepth(content, 0, content.length)).toBe(0);
    });

    test("should ignore braces in template literals", () => {
      const content = "{ `template with { braces }` }";
      expect(getBraceDepth(content, 0, content.length)).toBe(0);
    });

    test("should handle escaped quotes", () => {
      const content = '{ "escaped \\" quote" }';
      expect(getBraceDepth(content, 0, content.length)).toBe(0);
    });

    test("should handle mixed quotes", () => {
      const content = `{ "double" + 'single' + \`template\` }`;
      expect(getBraceDepth(content, 0, content.length)).toBe(0);
    });

    test("should handle nested braces", () => {
      const content = "{ a: { b: { c: 1 } } }";
      expect(getBraceDepth(content, 0, 10)).toBe(2);
      expect(getBraceDepth(content, 0, 15)).toBe(3);
    });

    test("should handle complex template literals", () => {
      const content = '{ `${foo({ bar: "baz" })} and ${nested.value}` }';
      expect(getBraceDepth(content, 0, content.length)).toBe(0);
    });

    test("should handle edge cases", () => {
      expect(getBraceDepth("", 0, 0)).toBe(0);

      expect(getBraceDepth("{{{}}}", 0, 6)).toBe(0);

      expect(getBraceDepth("{{{", 0, 3)).toBe(3);
      expect(getBraceDepth("}}}", 0, 3)).toBe(-3);

      const templateContent = "{ `${foo}` + `${bar}` }";
      expect(getBraceDepth(templateContent, 0, templateContent.length)).toBe(0);
    });
  });
});
