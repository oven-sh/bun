# Writes inputs.txt: 4000 short byte strings (hex, "-" for the empty one) from line breaks, multi-byte and broken UTF-8.
import random
random.seed(20260930)
atoms=[b'a',b'b',b' ',b'\n',b'\r',b'\r\n',b'\xe2\x80\xa8',b'\xe2\x80\xa9',b'\xc3\xa9',b'\xe4\xb8\xad',b'\xf0\x9f\x98\x80',
       b'\xff',b'\xe2',b'\x80',b'\xa8',b'\xe2\x80',b'\xed\xa0\x80',b'\xc0\x80',b'\xf0\x9f\x98',b'\xf4\x90\x80\x80',b'\xc2',b'\xef\xbb\xbf',b'\xe2\x80\xaa']
lines=[]
for i in range(4000):
    n=random.randint(0,14)
    s=b''.join(random.choice(atoms) for _ in range(n))
    lines.append(s.hex() if s else '-')
open('inputs.txt','w').write('\n'.join(lines)+'\n')
