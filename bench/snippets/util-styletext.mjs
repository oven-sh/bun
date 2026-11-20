import { Writable } from "node:stream";
import { inspect, styleText } from "node:util";
import { bench, run } from "../runner.mjs";

const noValidate = { validateStream: false };
const sink = () =>
  new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
  });
const terminal = { stream: Object.assign(sink(), { isTTY: true, getColorDepth: () => 8 }) };
const pipe = { stream: sink() };

// Colors that a program adds. `err` has the open code of `red` and another close code.
inspect.colors.err = [31, 0];
inspect.colors.orange = ["38;5;208", 39];

// The first call with a string format and `validateStream: false` takes the
// snapshot that such calls read. `late` is not in it.
styleText("red", "text", noValidate);
inspect.colors.late = [95, 39];
let lateWorks = true;
try {
  styleText("late", "text", noValidate);
} catch {
  // Bun v1.4.0 and Node.js v26.3.0 throw.
  lateWorks = false;
}

// More names than the inline cache of a call site holds.
for (const name of ["bold", "dim", "italic", "underline", "inverse", "green", "yellow", "blue", "magenta", "cyan"]) {
  styleText(name, "text", terminal);
  styleText([name], "text", noValidate);
}

const red = ["red"];
const green = ["green"];
const err = ["err"];
let turn = false;

bench("'red', validateStream: false", () => styleText("red", "text", noValidate));

// Every call below reads util.inspect.colors.
bench("'red'", () => styleText("red", "text"));
bench("'red', a terminal", () => styleText("red", "text", terminal));
bench("'red', not a terminal", () => styleText("red", "text", pipe));
bench("'grey' (an alias), a terminal", () => styleText("grey", "text", terminal));
bench("['red']", () => styleText(["red"], "text", noValidate));
bench("['bold', 'red']", () => styleText(["bold", "red"], "text", noValidate));
bench("['bold', 'underline', 'red']", () => styleText(["bold", "underline", "red"], "text", noValidate));
bench("['red'], ['green'] in turn", () => styleText((turn = !turn) ? red : green, "text", noValidate));
bench("['red'], ['err'] in turn (one open code)", () => styleText((turn = !turn) ? red : err, "text", noValidate));
bench("['red', 'err'] (one open code)", () => styleText(["red", "err"], "text", noValidate));
bench("['orange'] (a string code)", () => styleText(["orange"], "text", noValidate));
bench("['#ffcc00']", () => styleText(["#ffcc00"], "text", noValidate));
if (lateWorks) bench("'late', added after the snapshot", () => styleText("late", "text", noValidate));

await run();
