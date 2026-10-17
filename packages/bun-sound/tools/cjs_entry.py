#!/usr/bin/env python3
"""tools/cjs_entry.py <npm's own entry (.js)> <out>: THE ENTRY STAYS npm's OWN CommonJS TEXT: only its switch on process.env.NODE_ENV is resolved to the production arm, and each `require('./cjs/x.production.js')` whose typed text is laid reads `./cjs/x.production.ts`: names given behind the two paths say which (stems). WHY NOT AN ES MODULE: `import { anyName } from` a CommonJS entry never stops a build and reads undefined; an ES entry stops it; the namespace's keys, `require()`'s result and the default stay what they were. A typed text is an ES module: where npm's line takes the module itself (`module.exports = require(..)`) its `.default` is taken."""
import re, sys
src, out, stems = sys.argv[1], sys.argv[2], sys.argv[3:]
t = open(src).read()
m = re.search(r"if \(process\.env\.NODE_ENV === 'production'\) \{\n(.*?)\n\} else \{\n.*?\n\}\n", t, re.S)
if not m: sys.exit('cjs_entry: %s has no switch on NODE_ENV' % src)
arm = '\n'.join(l[2:] if l.startswith('  ') else l for l in m.group(1).split('\n'))
for s in stems: arm = arm.replace("require('./cjs/%s.js')" % s, "require('./cjs/%s.ts')" % s)
arm = re.sub(r"^module\.exports = require\('(\./cjs/[\w.-]+\.ts)'\);$", r"module.exports = require('\1').default;", arm, flags=re.M)
open(out, 'w').write(t[:m.start()] + arm + '\n' + t[m.end():]); print('cjs_entry: %s' % ' · '.join(re.findall(r"require\('[^']+'\)(?:\.default)?", arm)))
