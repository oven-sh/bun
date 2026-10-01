var nonascii: { "a-é": 1; é: 2; "tab\t": 3; "q\"q": 4 };
var esc: "tab\there" | 'quote"d' | "uni\u00e9\u{1F600}" | `tpl${number}` | "lone\uD800";
enum En { "k-é" = "vé" }
var en = En["k-é"];
class Ké { "m-é"(): void {} }
