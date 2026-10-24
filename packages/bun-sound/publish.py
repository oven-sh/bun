#!/usr/bin/env python3
"""publish.py pack <out: a new folder> [<name>@<version> ..]
       THE TARBALLS, byte for byte what `npm publish <file>` would send. Nothing is sent, nothing is installed, no network, no tool but Python 3.
       Reads this folder alone. All typed versions, or the named ones. Run twice, it writes the same bytes.
   publish.py gates <name> <node_modules that holds the package as installed> <out: a new folder>
       Every static gate (check.py) and the packer (pack.py) on the installed version, and then: what they give is what this folder holds. Needs SEMA and BUN (see README.md).
A tarball holds: package.json, sound.json, LICENSE, NOTICE, README.md and lay/. Never src/.
Before a tarball is written: the manifest, package.json and the folder's name agree; lay/ holds exactly the manifest's paths; every file has the sha256 that lay.sums pins; no file names a path or a person of the machines it was made on.
A version that keeps no lay/ (family.json: it differs from another version in its version string alone) is made from that version's lay/ here, and must come out with the sums its own lay.sums pins."""
import gzip, hashlib, io, json, os, re, subprocess, sys, tarfile
H = os.path.dirname(os.path.abspath(__file__))
if len(sys.argv) < 3 or sys.argv[1] not in ('pack', 'gates'): sys.exit(__doc__)
sha = lambda b: hashlib.sha256(b).hexdigest(); read = lambda p: open(p, 'rb').read()
if sys.argv[1] == 'gates':
    name, N, OUT = sys.argv[2], os.path.abspath(sys.argv[3]), os.path.abspath(sys.argv[4]); v = json.load(open(N + '/' + name + '/package.json'))['version']; D = H + '/' + name + '/' + v
    if not os.path.exists(D + '/sound.json'): sys.exit('publish.py: no %s/%s in this folder' % (name, v))
    r = subprocess.run([sys.executable, H + '/check.py', N, OUT + '/check', '--elements=plain', '--no-options'], capture_output=True, text=True)
    if r.returncode or ('%s@%s' % (name, v)).ljust(42) + ' same' not in r.stdout: sys.exit('publish.py: the gates fail:\n' + '\n'.join(l for l in r.stdout.split('\n') if l.startswith('FAIL') or ' same ' in l))
    r = subprocess.run([sys.executable, '-I', H + '/pack.py', N, OUT + '/check/sound', OUT + '/pack', name], capture_output=True, text=True)
    if r.returncode: sys.exit('publish.py: pack.py: ' + r.stderr[-400:])
    for f in ('sound.json', 'package.json', 'LICENSE', 'NOTICE', 'lay.sums'):
        if read(OUT + '/pack/' + name + '/' + v + '/' + f) != read(D + '/' + f): sys.exit('publish.py: %s is not this folder\'s' % f)
    print('publish.py: %s@%s: every gate passes, and what they give is what this folder holds' % (name, v)); sys.exit(0)
OUT = os.path.abspath(sys.argv[2]); only = set(sys.argv[3:])
if os.path.exists(OUT): sys.exit('publish.py: %s stands already: name another folder' % OUT)
PRIVATE = re.compile(rb"/Users/|/home/|/private/|/tmp/|[A-Z]:\\Users")
README = '''# %(flat)s

Sound TypeScript types for [%(name)s](https://www.npmjs.com/package/%(name)s/v/%(version)s) %(version)s, for `bun build --compile --aot`.

```sh
bun add -d %(flat)s@%(version)s
```

That is all. When `bun build --compile --aot` compiles %(name)s %(version)s and finds this package in the project's
`node_modules`, it compiles the files under `lay/` in place of the package's own. They are the package's own code with types
added; no statement was changed. Nothing in `node_modules/%(name)s` is touched, and a build without `--aot` does not look here.

The version must be exactly the installed one, and every file under `lay/`, without its types, must be the same code as the
installed file. Otherwise Bun says so in a warning and compiles the package as it always did.%(when)s

Licence: %(license)s, the package's own. See `LICENSE` and `NOTICE`.
'''
made = []
for d, ds, fs in sorted(os.walk(H)):
    ds[:] = sorted(x for x in ds if x not in ('lay', 'src', 'tools', 'trees', 'node_modules'))
    if 'sound.json' not in fs: continue
    S = json.loads(read(d + '/sound.json')); P = json.loads(read(d + '/package.json')); name, v = S['name'], S['version']; who = '%s@%s' % (name, v)
    if only and who not in only: continue
    stop = lambda why: sys.exit('publish.py: %s: %s' % (who, why)); flat = '@oven/sound-' + name.lstrip('@').replace('/', '__')
    if os.path.relpath(d, H) != name + '/' + v: stop('it lies in %s' % os.path.relpath(d, H))
    if S.get('sound') not in (1, 2) or set(S) != {'sound', 'name', 'version', 'when', 'basis', 'lay', 'needs'}: stop('sound.json has other members than the format\'s')
    if (P['name'], P['version'], P.get('peerDependencies')) != (flat, v, {name: v}): stop('package.json: name, version or the peer dependency are not the manifest\'s')
    if set(P) - {'name', 'version', 'description', 'license', 'peerDependencies', 'files'} or P['files'] != ['sound.json', 'lay', 'LICENSE', 'NOTICE']: stop('package.json holds more than a published package needs')
    sums = dict(reversed(l.split('  ', 1)) for l in read(d + '/lay.sums').decode().split('\n') if l)
    if set(sums) != set(S['lay']): stop('lay.sums and the manifest name other paths')
    if os.path.isdir(d + '/lay'):
        lay = {os.path.relpath(os.path.join(a, f), d + '/lay'): read(os.path.join(a, f)) for a, _, b in os.walk(d + '/lay') for f in b}
    else:
        K = json.loads(read(d + '/family.json')); k = H + '/' + name + '/' + K['of'] + '/lay'
        lay = {os.path.relpath(os.path.join(a, f), k): read(os.path.join(a, f)) for a, _, b in os.walk(k) for f in b}
        lay = {f: x.replace(b'"' + K['of'].encode() + b'"', b'"' + v.encode() + b'"').replace(name.encode() + b':  ' + K['of'].encode(), name.encode() + b':  ' + v.encode()) for f, x in lay.items()}
    if set(lay) != set(sums): stop('lay/ holds other files than the manifest names: %s' % sorted(set(lay) ^ set(sums))[:3])
    off = [f for f in lay if sha(lay[f]) != sums[f]]
    if off: stop('not the pinned bytes: %s' % off[:3])
    files = {'package.json': read(d + '/package.json'), 'sound.json': read(d + '/sound.json'), 'LICENSE': read(d + '/LICENSE'), 'NOTICE': read(d + '/NOTICE')}
    files['README.md'] = (README % dict(flat=flat, name=name, version=v, license=P['license'], when=''.join('\n\nIt applies to builds that define `%s` as `"%s"` (`--define \'%s="%s"\'`): the package\'s own entry would load other files elsewhere.' % (a, b, a, b) for a, b in S['when'].items()))).encode()
    files.update({'lay/' + f: x for f, x in lay.items()})
    for f, x in files.items():
        m = PRIVATE.search(x)
        if m: stop('%s names something of the machines it was made on: %r' % (f, x[max(0, m.start() - 40):m.end() + 20]))
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w', format=tarfile.USTAR_FORMAT) as t:
        for f in sorted(files):
            i = tarfile.TarInfo('package/' + f); i.size = len(files[f]); i.mode = 0o644; i.mtime = 499162500; i.uid = i.gid = 0; i.uname = i.gname = ''; t.addfile(i, io.BytesIO(files[f]))
    z = io.BytesIO()
    with gzip.GzipFile(filename='', mode='wb', fileobj=z, mtime=0, compresslevel=9) as g: g.write(raw.getvalue())
    os.makedirs(OUT, exist_ok=True); out = '%s-%s.tgz' % (flat.lstrip('@').replace('/', '-'), v); open(OUT + '/' + out, 'wb').write(z.getvalue()); made.append((out, len(files), len(z.getvalue()), sha(z.getvalue())))
if not made: sys.exit('publish.py: nothing is named so in this folder')
open(OUT + '/SUMS', 'w').write(''.join('%s  %s\n' % (h, f) for f, _, _, h in made))
for f, n, b, h in made: print('%-52s %3d files %9d B  %s' % (f, n, b, h[:16]))
print('publish.py: %d tarballs in %s. Nothing was sent. To publish one: npm publish <file> --access public' % (len(made), OUT))
