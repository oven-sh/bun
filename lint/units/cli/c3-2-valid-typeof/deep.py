# Writes the inputs of the depth runs of valid-typeof into the current directory. usage: python3 deep.py
open('vt-member.js', 'w').write('x = a' + '.b' * 400000 + ';\ntypeof x === undefined;\ntypeof x === "strnig";\n')
open('vt-member-before.js', 'w').write('typeof x === undefined;\ntypeof x === "strnig";\nx = a' + '.b' * 400000 + ';\n')
open('vt-leftchain.js', 'w').write('y = typeof a' + ' === "strnig"' * 20000 + ';\n')
open('vt-or.js', 'w').write('y = ' + ' || '.join(['typeof a === "strnig"'] * 1000) + ';\n')
open('vt-nested.js', 'w').write('y = ' + 'typeof (' * 3000 + 'a' + ' === "strnig")' * 3000 + ';\n')
