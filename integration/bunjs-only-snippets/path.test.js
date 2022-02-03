import { describe, it, expect } from "bun:test";
import * as path from "node:path";

const __filename = import.meta.file;

describe("path.basename", () => {
  it("basics", () => {
    expect(path.basename(__filename)).toBe("path.test.js");
    expect(path.basename(__filename, ".js")).toBe("path.test");
    expect(path.basename(".js", ".js")).toBe("");
    expect(path.basename("")).toBe("");
    expect(path.basename("/dir/basename.ext")).toBe("basename.ext");
    expect(path.basename("/basename.ext")).toBe("basename.ext");
    expect(path.basename("basename.ext")).toBe("basename.ext");
    expect(path.basename("basename.ext/")).toBe("basename.ext");
    expect(path.basename("basename.ext//")).toBe("basename.ext");
    expect(path.basename("aaa/bbb", "/bbb")).toBe("bbb");
    expect(path.basename("aaa/bbb", "a/bbb")).toBe("bbb");
    expect(path.basename("aaa/bbb", "bbb")).toBe("bbb");
    expect(path.basename("aaa/bbb//", "bbb")).toBe("bbb");
    expect(path.basename("aaa/bbb", "bb")).toBe("b");
    expect(path.basename("aaa/bbb", "b")).toBe("bb");
    expect(path.basename("/aaa/bbb", "/bbb")).toBe("bbb");
    expect(path.basename("/aaa/bbb", "a/bbb")).toBe("bbb");
    expect(path.basename("/aaa/bbb", "bbb")).toBe("bbb");
    expect(path.basename("/aaa/bbb//", "bbb")).toBe("bbb");
    expect(path.basename("/aaa/bbb", "bb")).toBe("b");
    expect(path.basename("/aaa/bbb", "b")).toBe("bb");
    expect(path.basename("/aaa/bbb")).toBe("bbb");
    expect(path.basename("/aaa/")).toBe("aaa");
    expect(path.basename("/aaa/b")).toBe("b");
    expect(path.basename("/a/b")).toBe("b");
    expect(path.basename("//a")).toBe("a");
  });

  it("On unix a backslash is just treated as any other character.", () => {
    expect(path.posix.basename("\\dir\\basename.ext")).toBe(
      "\\dir\\basename.ext"
    );
    expect(path.posix.basename("\\basename.ext")).toBe("\\basename.ext");
    expect(path.posix.basename("basename.ext")).toBe("basename.ext");
    expect(path.posix.basename("basename.ext\\")).toBe("basename.ext\\");
    expect(path.posix.basename("basename.ext\\\\")).toBe("basename.ext\\\\");
    expect(path.posix.basename("foo")).toBe("foo");
  });

  it("POSIX filenames may include control characters", () => {
    // c.f. http://www.dwheeler.com/essays/fixing-unix-linux-filenames.html
    var controlCharFilename = "Icon" + String.fromCharCode(13);
    expect(path.posix.basename("/a/b/" + controlCharFilename)).toBe(
      controlCharFilename
    );
  });
});

it("path.posix.extname", () => {
  var pairs = [
    [__filename, ".js"],
    ["", ""],
    ["/path/to/file", ""],
    ["/path/to/file.ext", ".ext"],
    ["/path.to/file.ext", ".ext"],
    ["/path.to/file", ""],
    ["/path.to/.file", ""],
    ["/path.to/.file.ext", ".ext"],
    ["/path/to/f.ext", ".ext"],
    ["/path/to/..ext", ".ext"],
    ["/path/to/..", ""],
    ["file", ""],
    ["file.ext", ".ext"],
    [".file", ""],
    [".file.ext", ".ext"],
    ["/file", ""],
    ["/file.ext", ".ext"],
    ["/.file", ""],
    ["/.file.ext", ".ext"],
    [".path/file.ext", ".ext"],
    ["file.ext.ext", ".ext"],
    ["file.", "."],
    [".", ""],
    ["./", ""],
    [".file.ext", ".ext"],
    [".file", ""],
    [".file.", "."],
    [".file..", "."],
    ["..", ""],
    ["../", ""],
    ["..file.ext", ".ext"],
    ["..file", ".file"],
    ["..file.", "."],
    ["..file..", "."],
    ["...", "."],
    ["...ext", ".ext"],
    ["....", "."],
    ["file.ext/", ".ext"],
    ["file.ext//", ".ext"],
    ["file/", ""],
    ["file//", ""],
    ["file./", "."],
    ["file.//", "."],
  ];

  pairs.forEach(function (p) {
    var input = p[0];
    var expected = p[1];
    expect(expected).toBe(path.posix.extname(input));
  });
});

it("path.posix.dirname", function (t) {
  expect(path.posix.dirname("/a/b/")).toBe("a");
  expect(path.posix.dirname("/a/b")).toBe("a");
  expect(path.posix.dirname("/a")).toBe("/");
  expect(path.posix.dirname("")).toBe(".");
  expect(path.posix.dirname("/")).toBe("/");
  expect(path.posix.dirname("//a")).toBe("//");
  expect(path.posix.dirname("foo")).toBe(".");
});

it("path.posix.isAbsolute", () => {
  expect(path.posix.isAbsolute("/home/foo")).toBe(true);
  expect(path.posix.isAbsolute("/home/foo/..")).toBe(true);
  expect(path.posix.isAbsolute("bar/")).toBe(false);
  expect(path.posix.isAbsolute("./baz")).toBe(false);
});

tape("path.posix.join", () => {
  var joinTests =
    // arguments                     result
    [
      [[".", "x/b", "..", "/b/c.js"], "x/b/c.js"],
      [[], "."],
      [["/.", "x/b", "..", "/b/c.js"], "/x/b/c.js"],
      [["/foo", "../../../bar"], "/bar"],
      [["foo", "../../../bar"], "../../bar"],
      [["foo/", "../../../bar"], "../../bar"],
      [["foo/x", "../../../bar"], "../bar"],
      [["foo/x", "./bar"], "foo/x/bar"],
      [["foo/x/", "./bar"], "foo/x/bar"],
      [["foo/x/", ".", "bar"], "foo/x/bar"],
      [["./"], "./"],
      [[".", "./"], "./"],
      [[".", ".", "."], "."],
      [[".", "./", "."], "."],
      [[".", "/./", "."], "."],
      [[".", "/////./", "."], "."],
      [["."], "."],
      [["", "."], "."],
      [["", "foo"], "foo"],
      [["foo", "/bar"], "foo/bar"],
      [["", "/foo"], "/foo"],
      [["", "", "/foo"], "/foo"],
      [["", "", "foo"], "foo"],
      [["foo", ""], "foo"],
      [["foo/", ""], "foo/"],
      [["foo", "", "/bar"], "foo/bar"],
      [["./", "..", "/foo"], "../foo"],
      [["./", "..", "..", "/foo"], "../../foo"],
      [[".", "..", "..", "/foo"], "../../foo"],
      [["", "..", "..", "/foo"], "../../foo"],
      [["/"], "/"],
      [["/", "."], "/"],
      [["/", ".."], "/"],
      [["/", "..", ".."], "/"],
      [[""], "."],
      [["", ""], "."],
      [[" /foo"], " /foo"],
      [[" ", "foo"], " /foo"],
      [[" ", "."], " "],
      [[" ", "/"], " /"],
      [[" ", ""], " "],
      [["/", "foo"], "/foo"],
      [["/", "/foo"], "/foo"],
      [["/", "//foo"], "/foo"],
      [["/", "", "/foo"], "/foo"],
      [["", "/", "foo"], "/foo"],
      [["", "/", "/foo"], "/foo"],
    ];

  joinTests.forEach(() => {
    var actual = path.posix.join.apply(null, p[0]);
    expect(actual).toBe(p[1]);
  });
});
