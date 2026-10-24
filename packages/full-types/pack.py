#!/usr/bin/env python3
"""usage: pack.py <node_modules> <full types> <out folder> [<package> ..]

Writes the folder that this repository has for full types and that publish.py publishes: <out folder>/<name>/<version>/.

  <node_modules>    the packages as npm installed them
  <full types>  <name>/full-types.json and <name>/lay/ for each package: the .full-types/ of a project
  <out folder>      a new folder
  <package> ..      the packages to pack. Default: every package in <full types>

The folder has:
  full-types.json    the manifest, in format 2. README.md describes its members.
  lay/<path>    each full-types file, at the path of the installed file that it replaces
  package.json  what npm needs to publish the folder: @oven/full-types-<name>, the version and the license of the package, and a peer
                dependency on exactly that version
  LICENSE       the package's own, as installed: lay/ is a copy of its code
  NOTICE        whose code it is, under which license, and which files were changed and how
  lay.sums      the sha256 and the path of each file under lay/

The manifest is not trusted. It is checked against <node_modules> as the compiler checks it in a build
(src/aot/load/typed_packages.rs): the format, the name, the version, each path, and the sha256 of each installed file in `lay`
and `basis`. lay/ must have exactly the files that `lay` lists. Of `needs` only the form is checked.

The package must have a LICENSE file and a copyright line. Under Apache-2.0, section 4(b), a changed file says that it was
changed: each full-types file starts with `// CHANGED: `.

If a package fails a check, nothing is written.

Whether a full-types file is the installed file with types added is not checked here. Every build does it."""
import hashlib, json, os, re, shutil, sys

if len(sys.argv) < 4:
    sys.exit(__doc__)
INSTALLED, TYPED, OUT = (os.path.abspath(argument) for argument in sys.argv[1:4])
for folder in (INSTALLED, TYPED):
    if not os.path.isdir(folder):
        sys.exit('pack.py: %s is not a folder' % folder)
if os.path.exists(OUT):
    sys.exit('pack.py: %s exists already: name a new folder' % OUT)
FORMAT = 2
MEMBERS = ('format', 'name', 'version', 'when', 'basis', 'lay', 'needs')
LICENSE_FILES = ('LICENSE', 'LICENSE.md', 'LICENSE.txt', 'License', 'license')
CHANGED = '// CHANGED: '
DESCRIPTION = (
    "Full types for %s %s: npm's own code with types added and nothing else changed, "
    'for `bun build --compile --aot`.'
)
NOTICE = '''%(companion)s %(version)s

This package holds files of %(name)s %(version)s (https://www.npmjs.com/package/%(name)s/v/%(version)s).
%(copyright)s
Licensed under %(license)s: see LICENSE, which is that package's own.

What was changed:
%(files)s
  TypeScript type annotations, type declarations, `declare`d fields and type-only casts were added to the
  package's own JavaScript. No statement and no expression was changed: with the types erased, each file
  prints as the file it was made from. Each takes the place of the package's file of the same name.

The additions are offered under the same licence as the package.
'''

sha256_of = lambda path: hashlib.sha256(open(path, 'rb').read()).hexdigest()
lines_of = lambda path: open(path, encoding='utf-8', errors='replace').read().split('\n')


def write_json(path, value):
    open(path, 'w').write(json.dumps(value, indent=2) + '\n')


def files_under(folder):
    return sorted(
        os.path.relpath(os.path.join(parent, file), folder).replace(os.sep, '/')
        for parent, _, files in os.walk(folder) for file in files
    )


def find_typed_packages():
    names = []
    for name in sorted(os.listdir(TYPED)):
        if os.path.isfile('%s/%s/full-types.json' % (TYPED, name)):
            names.append(name)
        elif os.path.isdir(TYPED + '/' + name):
            names += [
                name + '/' + member for member in sorted(os.listdir(TYPED + '/' + name))
                if os.path.isfile('%s/%s/%s/full-types.json' % (TYPED, name, member))
            ]
    return names


def find_copyright_line(paths):
    for path in paths:
        for line in lines_of(path)[:40]:
            match = re.search(r'Copyright (\(c\) )?(\d{4}|[A-Z]).*', line)
            if match:
                return match.group(0).strip()
    return None


def is_valid_path(path):
    return '\\' not in path and path != 'package.json' and all(part not in ('', '.', '..') for part in path.split('/'))


def is_valid_package_name(name):
    return isinstance(name, str) and is_valid_path(name) and name.count('/') <= (1 if name.startswith('@') else 0)


def is_string_map(value):
    return isinstance(value, dict) and all(isinstance(member, str) for member in value.values())


def check_manifest(manifest, name, version, stop):
    if not isinstance(manifest, dict):
        stop('full-types.json is not valid')
    if manifest.get('format') != FORMAT:
        stop('"format" in full-types.json is %s, and the compiler reads format %d only' % (
            json.dumps(manifest.get('format')), FORMAT,
        ))
    unknown = sorted(set(manifest) - set(MEMBERS))
    if unknown:
        stop('format %d has no "%s" in full-types.json' % (FORMAT, unknown[0]))
    if manifest.get('name') != name:
        stop('"name" in full-types.json is not the name of its folder')
    if manifest.get('version') != version:
        stop('they are for version %s, but %s is installed' % (manifest.get('version'), version))
    when, basis, lay = (manifest.get(member, {}) for member in ('when', 'basis', 'lay'))
    needs = manifest.get('needs', [])
    if not all(is_string_map(member) for member in (when, basis, lay)):
        stop('"when", "basis" and "lay" in full-types.json must be objects whose values are strings')
    if not isinstance(needs, list) or not all(is_valid_package_name(need) for need in needs):
        stop('"needs" in full-types.json must be a list of package names')
    for path in list(basis) + list(lay):
        if not is_valid_path(path):
            stop('"%s" in full-types.json is not a path inside the package' % path)
    if not lay:
        stop('"lay" in full-types.json is empty')
    return when, basis, lay, needs


def check_files(installed, typed, basis, lay, stop):
    for path in lay:
        if lay[path] == 'new':
            stop('they add %s, and full types can only replace installed files' % path)
        if path in basis:
            stop('%s is in "lay" and in "basis"' % path)
        if re.search(r'\.d\.[cm]?ts$', path):
            stop('%s is a declaration file, and full types replace code' % path)
    for path, digest in list(basis.items()) + list(lay.items()):
        installed_file = installed + '/' + path
        if not os.path.isfile(installed_file) or sha256_of(installed_file) != digest.lower():
            stop('the installed %s differs from the file these full types were written for' % path)
    typed_files = files_under(typed + '/lay')
    for path in lay:
        if path not in typed_files:
            stop('lay/%s is missing' % path)
    for path in typed_files:
        if path not in lay:
            stop('lay/%s is not in "lay" of full-types.json' % path)


def check_license(installed, typed, license_name, lay, stop):
    license_file = next((file for file in LICENSE_FILES if os.path.isfile(installed + '/' + file)), None)
    if not license_file:
        stop('it has no LICENSE file, and what is published is a copy of its code')
    copyright_line = find_copyright_line([installed + '/' + file for file in [license_file] + sorted(lay)])
    if not copyright_line:
        stop('no copyright line in its LICENSE file or at the top of the files that are replaced')
    if license_name == 'Apache-2.0':
        for path in lay:
            if not lines_of(typed + '/lay/' + path)[0].startswith(CHANGED):
                stop('lay/%s does not start with `%s`, and Apache-2.0 4(b) asks a changed file to say so' % (path, CHANGED))
    return installed + '/' + license_file, copyright_line


def check(name):
    def stop(message):
        sys.exit('pack.py: %s: %s' % (name, message))

    installed, typed = INSTALLED + '/' + name, TYPED + '/' + name
    if not os.path.isfile(typed + '/full-types.json'):
        stop('%s has no full types of it' % TYPED)
    if not os.path.isfile(installed + '/package.json'):
        stop('it is not installed in ' + INSTALLED)
    package = json.load(open(installed + '/package.json'))
    version, license_name = package.get('version'), package.get('license', 'UNLICENSED')
    if package.get('name') != name or not isinstance(version, str) or not version:
        stop('the installed package.json has another name, or no version')
    try:
        manifest = json.load(open(typed + '/full-types.json'))
    except ValueError:
        stop('full-types.json is not valid JSON')
    when, basis, lay, needs = check_manifest(manifest, name, version, stop)
    check_files(installed, typed, basis, lay, stop)
    license_file, copyright_line = check_license(installed, typed, license_name, lay, stop)
    companion = '@oven/full-types-' + name.lstrip('@').replace('/', '__')
    sorted_digests = lambda digests: {path: digest.lower() for path, digest in sorted(digests.items())}
    return dict(
        folder='%s/%s/%s' % (OUT, name, version),
        typed=typed,
        license_file=license_file,
        manifest={
            'format': FORMAT, 'name': name, 'version': version, 'when': dict(sorted(when.items())),
            'basis': sorted_digests(basis), 'lay': sorted_digests(lay), 'needs': needs,
        },
        package={
            'name': companion, 'version': version, 'description': DESCRIPTION % (name, version), 'license': license_name,
            'peerDependencies': {name: version}, 'files': ['full-types.json', 'lay', 'LICENSE', 'NOTICE'],
        },
        notice=NOTICE % dict(
            companion=companion, name=name, version=version, copyright=copyright_line, license=license_name,
            files='\n'.join('  lay/' + path for path in sorted(lay)),
        ),
    )


def write(packed):
    folder, manifest = packed['folder'], packed['manifest']
    lay = manifest['lay']
    for path in lay:
        os.makedirs(os.path.dirname(folder + '/lay/' + path), exist_ok=True)
        shutil.copy(packed['typed'] + '/lay/' + path, folder + '/lay/' + path)
    shutil.copy(packed['license_file'], folder + '/LICENSE')
    open(folder + '/NOTICE', 'w', encoding='utf-8').write(packed['notice'])
    open(folder + '/lay.sums', 'w').write(''.join('%s  %s\n' % (sha256_of(folder + '/lay/' + path), path) for path in lay))
    write_json(folder + '/full-types.json', manifest)
    write_json(folder + '/package.json', packed['package'])
    print('%s@%s: lay %d · basis %d · %d bytes · %s' % (
        manifest['name'], manifest['version'], len(lay), len(manifest['basis']),
        sum(os.path.getsize(folder + '/lay/' + path) for path in lay), folder,
    ))


names = sys.argv[4:] or find_typed_packages()
if not names:
    sys.exit('pack.py: %s has no full types' % TYPED)
for packed in [check(name) for name in names]:
    write(packed)
