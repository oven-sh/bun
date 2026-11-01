#!/usr/bin/env python3
"""Functions that build one string in a very long chain of statements, each using the string before it once: text added at the end, text
added in front, and a condition between the links. The seed is the number of links."""
import sys
links = int(sys.argv[1])
shapes = {
    "atTheEnd": lambda i: "  s = s + n + a;",
    "inFront": lambda i: "  s = a + n + s;",
    "withConditions": lambda i: '  s = (n > %d ? s + a : s + n) + "-";' % (i % 9),
}
for name, link in shapes.items():
    print("function %s(a: string, n: number): string {\n  let s = a;" % name)
    for i in range(links):
        print(link(i))
    print("  return s;\n}")
print("for (const build of [%s]) {" % ", ".join(shapes))
print('  const text = build("ab", 7);\n  let hash = 0;\n  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;')
print("  console.log(build.name, text.length, hash, text.slice(0, 12), text.slice(-8));\n}")
