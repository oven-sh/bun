// Worked examples of the writer (Go rules): what each kind of span prints.
import { type Diagnostic, type FileLike, WriterPanic, tsgoRules } from "./diagnosticwriter";
import { getErrorBaseline } from "./error_baseline";
const u = tsgoRules.model.fromString;
function show(title: string, content: string, spans: [number, number][], pretty = false): void {
  const text = u(content);
  const file: FileLike = { fileName: "/.src/a.ts", text };
  const diagnostics: Diagnostic[] = spans.map(([pos, end], k) => ({
    file, pos, end, code: 1000 + k, category: 1, messageText: "m" + k, messageChain: [], relatedInformation: [],
  }));
  console.log(`-- ${title}: content ${JSON.stringify(content)} spans ${JSON.stringify(spans)}`);
  try {
    const w = getErrorBaseline(tsgoRules, [{ unitName: "/.src/a.ts", content: text }], diagnostics, pretty);
    for (const line of tsgoRules.model.toString(w.text).split("\r\n")) console.log("   |" + JSON.stringify(line).slice(1, -1));
    if (w.failedChecks.length > 0) console.log("   failed checks: " + w.failedChecks.join("; "));
  } catch (e) {
    if (!(e instanceof WriterPanic)) throw e;
    console.log("   panic: " + e.message);
  }
}
show("length 0 inside a line", "ab\ncd\n", [[1, 1]]);
show("over a line break", "ab\ncd\n", [[1, 4]]);
show("the line break alone", "ab\ncd\n", [[2, 3]]);
show("at the end of the text", "ab\ncd\n", [[6, 6]]);
show("two on one line, one over two lines", "abc def\nghi\n", [[0, 3], [4, 10], [4, 7]]);
show("tab, two bytes, three bytes, four bytes before and inside", "\t\u00e9\u4e2d\ud83d\ude00xy\n", [[10, 12], [1, 10]]);
show("no-break space and vertical tab before", "\u00a0\x0bxy\n", [[3, 5]]);
show("CR LF text: span that ends before CR, after CR", "ab\r\ncd\r\n", [[0, 2], [0, 3]]);
show("CR LF text: start at the LF", "ab\r\ncd\r\n", [[3, 4]]);
show("CR alone in a line", "ab\rcd\nef\n", [[6, 8]]);
show("U+2028 in a line", "ab\u2028cd\nef\n", [[8, 10]]);
show("empty text", "", [[0, 0]]);
