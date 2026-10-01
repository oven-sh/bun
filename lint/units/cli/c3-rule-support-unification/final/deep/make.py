# Writes the inputs of the depth and cost runs into the current directory. usage: python3 make.py
open('member.js','w').write('x = a' + '.b'*400000 + ';\ndebugger;\nx == NaN;\nvar NaN;\n')
open('member2.js','w').write('x = a' + '.b'*400000 + ';\ndebugger;\nx == NaN;\n')
open('call.js','w').write('x = a' + '.b()'*200000 + ';\ndebugger;\n')
n=3000
open('pattern.js','w').write('['*n + 'a,,b' + ']'*n + ' = x;\n[c,,d];\n')
open('arr.js','w').write('x = ' + '['*n + '1,,2' + ']'*n + ';\n')
open('binary.js','w').write('x = ' + ' + '.join(['a']*300000) + ';\ny = ' + ' === -0 || '.join(['b']*1000) + ';\n')
open('selfassign.js','w').write('a' + '.b'*100000 + ' = a' + '.b'*100000 + ';\n')
open('index.js','w').write('a' + '[0]'*50000 + ' = a' + '[0]'*50000 + ';\n')
open('leftchain.js','w').write('y = x' + ' === -0'*5000 + ';\n')
open('leftchain2.js','w').write('y = x' + ' === -0'*20000 + ';\n')
open('cases.js','w').write('switch (x) {' + ''.join(' case %d: break;' % i for i in range(20000)) + ' }\n')
