// A statement imports a file of data as text, and an import() asks for the same file as toml. The loader of `bun run` keeps one module for both types, whichever is asked for first,
// so what the statement binds is no constant of the build: the test of its type stays a test, and both arms stay. A file that no call asks for under another type is the text that the build has read.

// RUN(SHARED): lower
// SHARED-LABEL: function {{*}}name="shared"
// SHARED: [[isText]] = TypeTest {{*}}testedType=string
// SHARED: Branch [[isText]]
// SHARED: = String string="the arm for data"

// RUN(ALONE): lower
// ALONE-LABEL: function {{*}}name="alone"
// ALONE-NOT: Branch
// ALONE-NOT: string="the other arm for data"
// ALONE: = String string="the other arm for a text"

// FILE: main.mjs
import first from "./first.toml" with { type: "text" };
import second from "./second.toml" with { type: "text" };
export const call = import("./first.toml", { with: { type: "toml" } });
export function shared() {
  return typeof first === "string" ? "the arm for a text" : "the arm for data";
}
export function alone() {
  return typeof second === "string" ? "the other arm for a text" : "the other arm for data";
}

// FILE: first.toml
port = 21

// FILE: second.toml
port = 22
