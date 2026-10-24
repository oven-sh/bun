// The types written inside Bun's own modules are predictions: an argument of another kind reaches the function's own validation and gets that error, with its code, as in plain Bun. The same parameter written in the program is a prediction too: the value goes the slow way and the function answers as in plain Bun.
import stream from "node:stream";
import url from "node:url";

const streams: any = stream;
const urls: any = url;
const five: any = 5;
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).name, String((e as { code?: string }).code)); }
}
function pathToText(filepath: string) { return "file://" + filepath; }

attempt("url.pathToFileURL(5)", () => urls.pathToFileURL(five));
attempt("new url.Url().parse(5)", () => new urls.Url().parse(five));
attempt('stream.setDefaultHighWaterMark(false, "many")', () => streams.setDefaultHighWaterMark(false, "many"));
attempt('stream.setDefaultHighWaterMark("yes", 7)', () => { streams.setDefaultHighWaterMark("yes", 7); return streams.getDefaultHighWaterMark(true); });
attempt("a function of the program with (filepath: string), given 5", () => pathToText(five));
