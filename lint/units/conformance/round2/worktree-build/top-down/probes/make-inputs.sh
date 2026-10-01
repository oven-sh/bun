#!/bin/sh
# Recreates the input files of probe.ts, symprobe.ts, refusals.ts and the crash probes below /tmp/conf-wb-1b/probe.
# usage: sh make-inputs.sh
set -e
P=/tmp/conf-wb-1b/probe
rm -rf "$P"; mkdir -p "$P/sub/deep" "$P/other" "$P/sp ace" "$P/dir.ts"; cd "$P"
printf 'export const x: number = 1;\nexport function f(a: string): string { return a; }\n' > clean.ts
printf 'const = ;\n' > bad.ts
cp bad.ts BAD.TS
printf 'export const a = <div>{1}</div>;\n' > ok.tsx
printf 'export const a = <div>{1}</span>;\n' > bad.tsx
printf 'debugger;\n' > dbg.js
printf 'debugger;\n' > dbg.ts
printf 'const = ;\n' > bad.d.ts
printf 'export const x: number;\n' > ok.d.ts
printf '{}\n' > data.json
printf 'let a = 1;\r\nconst = ;\r\n' > crlf.ts
printf 'let a = 1;\rconst = ;\r' > cr.ts
printf '\357\273\277const = ;\n' > bom.ts
printf '\357\273\277debugger;\n' > bom.js
printf 'function f() {\n  return\n  1;\n}\nf();\n' > warn.ts
cp warn.ts warn.js
printf 'const = ;\n' > sub/deep/rel.ts
printf 'const = ;\n' > "sp ace/a (1).ts"
printf 'let s = "\360\237\230\200"; const = ;\n' > astral.ts
printf 'var x = 0;\nswitch (x) { case 1: break; case 1: break; }\nif (x === -0) {}\nx = x;\n' > rules.js
: > empty.ts
printf 'let x = 1;\n--> legacy\n' > htmlclose.js
cp htmlclose.js htmlclose.ts
printf 'export const a = <div key />;\n' > key.tsx
cp key.tsx key.jsx
printf '/** @jsxRuntime preserve */\nexport const a = 1;\n' > pragma.tsx
printf 'class A { #m() {} f() { this.#m = 1; } }\n' > priv.ts
printf 'class A { #m() {} f() { this.#m = 1; } }\nconst = ;\n' > warnerr.ts
printf 'const = ;\n' > noperm.ts; chmod 000 noperm.ts
printf 'export const x = 1;\n' > mod.mts
printf 'module.exports = 1; debugger;\n' > c.cjs
printf 'const = ;\n' > e.cts
printf 'debugger;\n' > m.mjs
printf 'debugger;\n' > j.jsx
printf 'let a: number = "s";\nlet b = undefinedName;\n' > typeerr.ts
ln -sf bad.ts lnk.ts
ln -sfn "$P" /tmp/conf-wb-1b/link
python3 - <<'PY'
P = '/tmp/conf-wb-1b/probe'
open(P + '/deep.ts', 'w').write('let x = ' + '(' * 200000 + '1' + ')' * 200000 + ';\n')
open(P + '/deep.js', 'w').write('let x = ' + '[' * 200000 + ']' * 200000 + ';\n')
open(P + '/big.ts', 'w').write(''.join('export function f%d(a: number, b: string): string { return b + a + %d; }\n' % (i, i) for i in range(14000)))
PY
mkdir -p /tmp/conf-wb-1b/fakebin
printf '#!/bin/sh\necho "curl called: $*" >> /tmp/conf-wb-1b/fakecurl.log\nexit 0\n' > /tmp/conf-wb-1b/fakebin/curl
chmod +x /tmp/conf-wb-1b/fakebin/curl
echo "inputs at $P"
