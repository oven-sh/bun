#!/usr/bin/env bash
# Writes the files that obs.ts reads into /tmp/conf-wb/fx and /tmp/conf-wb/other (the bytes matter: printf, not an editor).
set -euo pipefail
mkdir -p /tmp/conf-wb/fx/sub /tmp/conf-wb/other
cd /tmp/conf-wb/fx
printf 'export const x: number = 1;\n' > clean.ts
printf 'const = ;\n' > bad.ts
printf 'export const e = <div className="a">hi</div>;\n' > clean.tsx
printf 'const e = <div>;\n' > bad.tsx
printf 'debugger;\n' > dbg.js
printf 'declare const = ;\n' > bad.d.ts
printf 'declare const x: number;\n' > ok.d.ts
printf '{"a": 1}\n' > data.json
printf 'let a = 1;\r\nconst = ;\r\n' > crlf.ts
printf 'let a = 1;\r\ndebugger;\r\n' > crlf.js
printf '\xef\xbb\xbfconst = ;\n' > bom.ts
printf '\xef\xbb\xbfdebugger;\n' > bom.js
printf 'function f() {\n  return\n  1;\n}\n' > warn.ts
printf 'function f() {\n  return\n  1;\n}\n' > warn.js
printf 'let x = 1;\n--> a legacy comment\n' > warn2.js
printf 'debugger;\n' > sub/inner.js
printf 'const = ;\n' > sub/inner.ts
printf 'let s = "\xc3\xa9\xf0\x9f\x98\x80"; const = ;\n' > utf16.ts
printf 'let a = 1;\rconst = ;\r' > cr.ts
printf 'debugger;' > noeol.js
: > empty.ts
printf 'const x = <T>(a: T) => a;\nlet y = <div/>;\n' > mixed.ts
printf 'enum E { A = 1 }\nnamespace N { export const a = 1 }\nabstract class C { abstract m(): void }\n' > tsonly.ts
