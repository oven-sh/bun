// Programs whose executable once answered otherwise than plain Bun on one platform alone. A run takes a part of each folder, and which part goes by the commit,
// so such a program may stay unseen on that platform for many runs. Each is listed here, and every run takes all of them.
import { programsBuiltWith } from "./run-programs";

// Windows: an observer had heard nothing yet of the marks made five milliseconds before. The program now waits until it has.
programsBuiltWith("library-modules", "in-every-run", [], {}, 1, 1, ["contexts-hooks-and-measurements"]);
// Windows: a function of the library makes the object of the environment there. It was left out where nobody names `env`, and a function stood in the object's place.
programsBuiltWith("every-member-of-a-host-object", "in-every-run", [], {}, 1, 1, [
  "every-member-of-bun-is-read",
  "every-member-of-process-is-read",
]);
// Linux on ARM64: where the calls of operations are counted, the program did not end, in the engine's shell and as an executable.
for (const [label, flags] of [
  ["in-every-run", []],
  ["in-every-run-every-function-hot", ["--aot-heat=everything-is-hot"]],
  ["in-every-run-every-function-cold", ["--aot-heat=everything-is-cold"]],
  ["in-every-run-every-function-neither-hot-nor-cold", ["--aot-heat=nothing-is-hottest"]],
] as const) {
  programsBuiltWith("arrays", label, [...flags], {}, 1, 1, ["index-fill-grows-like-push"]);
  programsBuiltWith("arrays", `${label}-with-counts`, [...flags], { BUN_JSC_aotCountsPath: "/dev/null" }, 1, 1, [
    "index-fill-grows-like-push",
  ]);
}
// Windows: process.cwd() spelled a folder of the executable with `/` where `__dirname` has `\`.
programsBuiltWith("modules", "in-every-run", [], {}, 1, 1, ["the-working-directory-is-a-folder-of-the-executable"]);
// Windows: `path.join(__dirname) + "/a.js"` spells the folder with `\` and the rest with `/`. The executable took that for the path of another file.
// Windows: `path.join(__dirname, name)` spells `.\lib` what the build knows as `./lib`. `require()` finds the file under a name that is computed too.
programsBuiltWith("static-modules", "in-every-run", [], {}, 1, 1, [
  "five-names/path-join-replaced",
  "five-names/path-join-slashes",
]);
// Windows on x64: a catch clause gets what code of the program throws inside an operation of the run time.
programsBuiltWith("errors", "in-every-run", [], {}, 1, 1, ["what-is-thrown-inside-an-operation-is-what-is-caught"]);
