// A string that the program has cut out of a longer one is compared with literals, one after the other.
import { nextTurns } from "../host.ts";
const words: string[] = "text,tool_use,tool_result,thinking,image,document,redacted_thinking,server_tool_use".split(",");
function kind(t: string): number { if (t === "text") return 1; if (t === "tool_use") return 2; if (t === "tool_result") return 3; if (t === "thinking") return 4; if (t === "image") return 5; return 0; }
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += kind(words[i & 7]);
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + bench(n)) | 0;
console.log(check);
