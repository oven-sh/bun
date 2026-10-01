# Writes the generated probe inputs into the directory given as the first argument.
import sys
d = sys.argv[1]
def w(name, text): open(d + '/' + name, 'w').write(text)
# 2,100 array mutations after the declaration: past the depth stop of getTypeAtFlowNode
w('toolarge.ts', 'const data = [];\n' + 'data[0] = 0;\n' * 2100 + 'const last: string = data;\nfunction g() { let z = []; z[0] = 1; const q: string = z; }\n')
# the two sides of the depth stop: 1,999 mutations pass, 2,000 trip it
w('edge1999.ts', 'const data = [];\n' + 'data[0] = 0;\n' * 1999 + 'const last: string = data;\n')
w('edge2000.ts', 'const data = [];\n' + 'data[0] = 0;\n' * 2000 + 'const last: string = data;\n')
# 4,953 nested binary expressions, the count of compiler/binderBinaryExpressionStress.ts
w('deepbin.ts', 'var caps = ' + "'' +\n" * 4953 + "'';\nconst q: number = caps;\n")
# 3,000 nested || with a context sensitive function at the end
w('deepor.ts', 'declare const f: ((x: number) => void) | undefined;\nconst g: (x: number) => void = ' + "f ||\n" * 3000 + "(x => x.length);\n")
