// spyOn stores the spy on the object by a store of native code, and mockRestore puts the member back.
import { spyOn } from "bun:test";

const random = spyOn(Math, "random").mockReturnValue(0.5);
console.log(Math.random(), random.mock.calls.length);
random.mockRestore();
console.log(Math.random() !== 0.5);
const now = spyOn(Date, "now").mockImplementation(() => 42);
console.log(Date.now(), now.mock.calls.length);
now.mockRestore();
console.log(Date.now() !== 42);
const cwd = spyOn(process, "cwd").mockReturnValue("/elsewhere");
console.log(process.cwd());
cwd.mockRestore();
console.log(process.cwd() !== "/elsewhere");
const parse = spyOn(JSON, "parse");
console.log(JSON.parse("[1]").length, parse.mock.calls.length);
parse.mockRestore();
const which = spyOn(Bun, "which").mockReturnValue("nowhere");
console.log(Bun.which("ls"));
which.mockRestore();
console.log(Bun.which("ls") !== "nowhere");
