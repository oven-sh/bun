#!/usr/bin/env python3
"""usage: check.py <node_modules> [<out folder>] [--only=<part of a package's name>] [--elements=shared|plain]

The static checks of the typed versions in this folder. Runs no package code.

A typed version is npm's production file with types added and nothing else changed: <name>/<version>/src/typed.cts or
typed.mts, with the declarations of its object types (*.d.ts) beside it. npm's own files are not in this folder. They are read
from <node_modules>, and must be byte for byte the files that the types were written for.

Environment:
  SEMA             the type checker's command-line tool: `$SEMA cli <file> --noEmit --all`
  BUN              any Bun, used to print a file without its types. Default: bun
  BUN_SEMA_TS_LIB  TypeScript's lib folder

The gates, for each package that <node_modules> has at that version:
  md5      npm's file is the one that the types were written for.
  errors   The type checker reports nothing in the typed file.
  verify   Without the text between /*$*/ markers and without the suffixes `$given` and `$as<Role>`, the typed file prints as
           npm's file does, line for line. Bun prints both.
  splits   tools/splits1.py: a variable that was split into roles follows the data flow of npm's file. `verify` cannot see a
           wrong split.
  counts   The number of role variables is the expected one. Also prints the number of `any`, casts and `!`.
  fields   tools/declare_fields.py: a class field that the typed file adds is `declare`d.
  form     The CommonJS file becomes an ES module with its declarations appended (tools/module_form8.py). For
           react-reconciler, the types of objects that other code creates become `any` (tools/given2.py), and a React element
           has the type that the typed jsx-runtime declares (--elements=shared) or is `any` (--elements=plain). react-dom's
           bundles stay CommonJS at npm's own path (format 2 of sound.json, written to <out>/sound/react-dom): the typed file,
           followed by the declarations of the ES module form. So the compiler still drops an export of theirs that nothing
           reads.
  clean    tools/clean_lay.py removes the notes from the generated file.
  changed  (Apache-2.0 packages) The generated file says on its first line that it was changed.
  entry    tools/cjs_entry.py rewrites the entry point to load the generated file.
  laid     The packages are copied to <out>/node_modules, and the generated files are written into the copy. Each has no error
           when it is checked there, under --strict and as a build checks it (--aot: the compiler declares
           `import("bun").int32` itself, whatever bun-types is installed). An error on one of the appended
           `import * as x$module` lines is ignored and counted in the output.
  lax      Each generated file also has no error under `noImplicitAny: false`, `strictNullChecks: false` and `strict: false`.
           Those options of the user's tsconfig.json apply to a package too, and one error compiles it untyped.
  same     lay/ in the repository is byte for byte what src/ generates, and the sha256 sums in sound.json are those of the
           installed files.

Writes <out>/laid/<package>/ (the generated files), <out>/sound/<package>/ (what a project has as .sound/<package>/) and
<out>/node_modules, which `bun build --compile --aot` can build against. Exits with 1 if a gate fails.

It does not check that the types are true. run.py does, for the code that its test trees run."""
import hashlib, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = HERE + '/tools'
arguments = [argument for argument in sys.argv[1:] if not argument.startswith('--')]
options = dict((argument[2:].split('=', 1) + [''])[:2] for argument in sys.argv[1:] if argument.startswith('--'))
if not arguments:
    sys.exit(__doc__)
INSTALLED = os.path.abspath(arguments[0])
OUT = os.path.abspath(arguments[1]) if len(arguments) > 1 else os.path.abspath('ship.out')
# `plain` is what is published: no package imports another package's types.
ELEMENTS = options.get('elements', 'plain')
SEMA = os.environ.get('SEMA') or sys.exit('check.py: set SEMA=<the type checker>')
BUN = os.environ.get('BUN', 'bun')
ENV = dict(os.environ, NO_COLOR='1')
# Interfaces that tools/given2.py leaves as they are (--live).
EXEMPT_INTERFACES = 'FiberConstructor,FiberRootConstructor,ConcurrentUpdate,ConcurrentQueue,StoreInstance'

# name      the folder of the typed file
# npm, md5  npm's file and its md5
# lay       where the generated file goes
# space     the namespace of its declarations
# entries   the entry points that are rewritten
# form      how the file under lay/ is generated from the one under src/
# expected  the expected number of role variables, if it is pinned
# versions  for a typed file that serves several versions: the md5 of npm's file in each
# token     the version string in that typed file
# text      the name of the typed file, if it is not typed.cts
# changed   the notice that goes on the first line of the generated file
# skipped   why the generated file is not written to <out>/node_modules
PACKAGES = [
    dict(
        name='react-reconciler@0.33.0',
        npm='react-reconciler/cjs/react-reconciler.production.js',
        md5='1ce09a736d5c21646595d20964d9b01d',
        lay='react-reconciler/cjs/react-reconciler.production.ts',
        space='RR',
        entries={'react-reconciler/index.js': 'export { default } from "./cjs/react-reconciler.production.ts";'},
        form='reconciler',
        expected=dict(variants=539),
    ),
    dict(
        name='react-dom@19.3.1.server.bun',
        npm='react-dom/cjs/react-dom-server.bun.production.js',
        md5='18d04fee389023d0b4c6844de16c5317',
        lay='react-dom/cjs/react-dom-server.bun.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=196),
    ),
    dict(
        name='react-dom@19.3.1.server-legacy.browser',
        npm='react-dom/cjs/react-dom-server-legacy.browser.production.js',
        md5='4896a582e13f60a195b4a97bfed10db7',
        lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=181),
    ),
    dict(
        name='react-dom@19.3.0.server.bun',
        npm='react-dom/cjs/react-dom-server.bun.production.js',
        md5='e6c2b1151664227396c16e5217ae9e4b',
        lay='react-dom/cjs/react-dom-server.bun.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=196),
    ),
    dict(
        name='react-dom@19.3.0.server-legacy.browser',
        npm='react-dom/cjs/react-dom-server-legacy.browser.production.js',
        md5='2b8f4172ffbe52177acfc592892704c5',
        lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=181),
    ),
    dict(
        name='react@19.2.0',
        npm='react/cjs/react.production.js',
        md5='e255db46a1de0ffd84470b0ae50bdc7b',
        lay='react/cjs/react.production.ts',
        space='RE',
        entries={
            'react/index.js': 'export * from "./cjs/react.production.ts"; export { default } from "./cjs/react.production.ts";',
        },
        form='plain',
        expected=dict(variants=7),
        skipped=(
            'skipped: typed react creates elements and refs that have layouts, and they reach untyped components. '
            'It is checked here, and it is written to node_modules only if --only=react@ names it'
        ),
    ),
    # One typed file serves react-dom 19.2.1 to 19.2.8, which differ only in their version string (three lines of the Bun
    # bundle, one of the legacy bundle). It is the file for 19.2.8, and `token` is replaced by the installed version.
    dict(
        name='react-dom@19.2.8.server.bun',
        npm='react-dom/cjs/react-dom-server.bun.production.js',
        md5='',
        versions={
            '19.2.1': '899478566fc3da3aa4febc9e8cd470ff',
            '19.2.3': '26778be71aa576db8858056167bfeefb',
            '19.2.4': '6aea6e2987ad1079f7f023976b45553f',
            '19.2.5': 'bbde81e7a3208802f5ba1207c39912bf',
            '19.2.6': '9a61014a48420a727dae50f458681d23',
            '19.2.7': '1430fcfed07c0463f48ec5f11164b895',
            '19.2.8': '5ab8078026a6d607cd47bd188d978a41',
        },
        token='19.2.8',
        lay='react-dom/cjs/react-dom-server.bun.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=None),
    ),
    dict(
        name='react-dom@19.2.8.server-legacy.browser',
        npm='react-dom/cjs/react-dom-server-legacy.browser.production.js',
        md5='',
        versions={
            '19.2.1': '5b1afbdf24b5347d741fc55060471ac6',
            '19.2.3': '3abd283ea5ff4290fa6bf34f7d352523',
            '19.2.4': 'b18b197d5388d62ce3622a8b28ca9257',
            '19.2.5': '2dfa68fa80b2c2ce0b9b71ab7152fceb',
            '19.2.6': '5f5c98f1a88893281b720d66f2ebbd5b',
            '19.2.7': '175b25156ea2b9e44bcae7699d3fa877',
            '19.2.8': 'fd192878320c40558820151cdad247f1',
        },
        token='19.2.8',
        lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=None),
    ),
    dict(
        name='react-dom@19.1.0.server.bun',
        npm='react-dom/cjs/react-dom-server.bun.production.js',
        md5='',
        versions={'19.1.0': 'd1621ecc41503b9f1f50bd0f6adbfcc5'},
        token='19.1.0',
        lay='react-dom/cjs/react-dom-server.bun.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=None),
    ),
    dict(
        name='react-dom@19.1.0.server-legacy.browser',
        npm='react-dom/cjs/react-dom-server-legacy.browser.production.js',
        md5='',
        versions={'19.1.0': 'b7f2174298ea478f8839c7f0a0fddf7c'},
        token='19.1.0',
        lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=None),
    ),
    dict(
        name='react-dom@19.0.0.server.bun',
        npm='react-dom/cjs/react-dom-server.bun.production.js',
        md5='',
        versions={'19.0.0': '77386dba2c969d674d387beed1e5cb91'},
        token='19.0.0',
        lay='react-dom/cjs/react-dom-server.bun.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=None),
    ),
    dict(
        name='react-dom@19.0.0.server-legacy.browser',
        npm='react-dom/cjs/react-dom-server-legacy.browser.production.js',
        md5='',
        versions={'19.0.0': 'ec9baf4e855b4f79f82865ba0e0767c2'},
        token='19.0.0',
        lay='react-dom/cjs/react-dom-server-legacy.browser.production.ts',
        space='FZ',
        entries={},
        form='placed',
        expected=dict(variants=None),
    ),
    dict(
        name='fuse.js@7.0.0',
        npm='fuse.js/dist/fuse.mjs',
        md5='8acfaae5c1dd70a090f5b75a3f8ad467',
        lay='fuse.js/dist/fuse.sound.ts',
        space='FU',
        entries={'fuse.js/dist/fuse.mjs': 'export { default } from "./fuse.sound.ts";'},
        form='esm',
        text='typed.mts',
        expected=dict(variants=0),
        changed='// CHANGED: this is dist/fuse.mjs of fuse.js 7.0.0 with TypeScript types added. No code was changed. See NOTICE.',
    ),
    dict(
        name='seroval@1.6.9',
        npm='seroval/dist/index.js',
        md5='ccbd09502b548d78881f2353cf209c2b',
        lay='seroval/dist/index.sound.ts',
        space='SV',
        entries={'seroval/dist/index.js': 'export * from "./index.sound.ts";'},
        form='esm',
        text='typed.mts',
        expected=dict(variants=0),
    ),
]

# A package of many ES modules, of which the hot ones are typed. <file>.mjs has the typed file <file>.sound.mts (the package is
# "type": "commonjs", so a .ts file there would be CommonJS) and becomes `export * from "./<base>.sound.mts";`. An import of one
# typed file by another is rewritten to the .sound.mts file, so that the checker sees its types and not the package's .d.mts.
MODULE_PACKAGES = [
    dict(
        name='@anthropic-ai/sdk',
        version='0.112.1',
        folder='@anthropic-ai__sdk@0.112.1',
        src='@anthropic-ai/sdk/0.112.1/src',
        lib='esnext,dom',
        files={
            'internal/utils/bytes': 'f3bbbc15d1132a24c7c8fc4b112e8742',
            'internal/decoders/line': '53d0301e5b811061c98d9d5c091cb39c',
            'core/streaming': 'c443e04b269bb5631095ca00166dfd6c',
        },
    ),
    dict(
        name='@anthropic-ai/sdk',
        version='0.128.0',
        folder='@anthropic-ai__sdk@0.128.0',
        src='@anthropic-ai/sdk/0.128.0/src',
        lib='esnext,dom',
        files={
            'internal/utils/bytes': 'f3bbbc15d1132a24c7c8fc4b112e8742',
            'internal/decoders/line': 'e483a999dd6a0136d95069e196e5ae1b',
            'core/streaming': '952256aac92d3a6beebc6eaa7c2700f3',
        },
    ),
]

# The sources of each package in the repository. A folder packages/<name>@<version> beside this file takes precedence.
SOURCE_FOLDERS = {
    'react-reconciler@0.33.0': 'react-reconciler/0.33.0/src',
    'react-dom@19.3.1.server.bun': 'react-dom/19.3.1/src/server.bun',
    'react-dom@19.3.1.server-legacy.browser': 'react-dom/19.3.1/src/server-legacy.browser',
    'react-dom@19.3.0.server.bun': 'react-dom/19.3.0/src/server.bun',
    'react-dom@19.3.0.server-legacy.browser': 'react-dom/19.3.0/src/server-legacy.browser',
    'react-dom@19.2.8.server.bun': 'react-dom/19.2.8/src/server.bun',
    'react-dom@19.2.8.server-legacy.browser': 'react-dom/19.2.8/src/server-legacy.browser',
    'react-dom@19.1.0.server.bun': 'react-dom/19.1.0/src/server.bun',
    'react-dom@19.1.0.server-legacy.browser': 'react-dom/19.1.0/src/server-legacy.browser',
    'react-dom@19.0.0.server.bun': 'react-dom/19.0.0/src/server.bun',
    'react-dom@19.0.0.server-legacy.browser': 'react-dom/19.0.0/src/server-legacy.browser',
    'react@19.2.0': 'react/19.2.0/src',
    'seroval@1.6.9': 'seroval/1.6.9/src',
    'fuse.js@7.0.0': 'fuse.js/7.0.0/src',
}

# For --elements=shared: react's jsx-runtime, a small file that is typed as a whole.
SMALL_FILES = {
    'react-jsx-runtime.ts': (
        'react/cjs/react-jsx-runtime.production.js',
        'c172c62d2a67eb3c684b85f92e08631a',
        'react/cjs/react-jsx-runtime.production.ts',
        'react/jsx-runtime.js',
        'export * from "./cjs/react-jsx-runtime.production.ts"; export { default } from "./cjs/react-jsx-runtime.production.ts";',
    ),
}

# Format 2 of sound.json: a small CommonJS file keeps its path and its `exports.name = ..`, so the entry point, and the way an
# importer finds a name, stay npm's own. The typed file is a .cts file under src/. It is not written to <out>/node_modules,
# where a .js file would be read as JavaScript, but to <out>/sound/<package>/. run.py copies that folder into the typed
# projects.
PLACED = {
    'react': [
        dict(
            text='react/19.2.0/src/react-compiler-runtime.cts',
            npm='cjs/react-compiler-runtime.production.js',
            md5='0813f4fe514266e7865d2f2553e11c76',
        ),
    ],
}

md5_of = lambda path: hashlib.md5(open(path, 'rb').read()).hexdigest()
without_colors = lambda text: re.sub(r'\x1b\[[0-9;]*m', '', text)


def run(command, cwd=None):
    result = subprocess.run(command, cwd=cwd, env=ENV, capture_output=True, text=True)
    return result.returncode, without_colors(result.stdout + result.stderr)


def erase_markers(text):
    text = re.sub(r'/\*\$\*/.*?/\*\$\*/', '', text, flags=re.S)
    text = re.sub(r'\b([A-Za-z_$][\w$]*?)\$given\b', r'\1', text)
    return re.sub(r'\b([A-Za-z_$][\w$]*?)\$as[A-Z]\w*\b', r'\1', text)


def printed_lines(path, cwd):
    result = subprocess.run([BUN, 'build', '--no-bundle', '--target=bun', path], cwd=cwd, capture_output=True, text=True)
    return [line for line in result.stdout.split('\n') if line.strip()]


failures = 0
generated_files = []
placed_bundles = {}


def report(passed, package, gate, message):
    global failures
    if not passed:
        failures += 1
    print('%-4s %-42s %-7s %s' % ('ok' if passed else 'FAIL', package, gate, message))


if os.path.exists(OUT):
    sys.exit('check.py: %s exists. Name another folder: check.py removes nothing' % OUT)
os.makedirs(OUT + '/work')
os.makedirs(OUT + '/laid')
for folder in (
    'react', 'react-dom', 'react-reconciler', 'scheduler', 'seroval', 'fuse.js', '@anthropic-ai/sdk', '@types', 'csstype',
    'undici-types',
):
    if os.path.isdir(INSTALLED + '/' + folder):
        shutil.copytree(INSTALLED + '/' + folder, OUT + '/node_modules/' + folder, symlinks=True)

for package in PACKAGES:
    name = package['name']
    if options.get('only') and options['only'] not in name:
        continue
    # SHIP_PACKAGES: the copies that sabotage.py changes.
    source = (
        os.environ['SHIP_PACKAGES'] + '/' + name if os.environ.get('SHIP_PACKAGES')
        else HERE + '/packages/' + name if os.path.isdir(HERE + '/packages/' + name)
        else HERE + '/' + SOURCE_FOLDERS[name]
    )
    installed_file = INSTALLED + '/' + package['npm']
    typed_file = package.get('text', 'typed.cts')
    extensions = ('mjs', 'mts') if package['form'] == 'esm' else ('cjs', 'cts')
    # A typed file that is not published is not in the repository.
    if not os.path.exists(source + '/' + typed_file):
        continue
    if not os.path.exists(installed_file):
        print('--   %-42s         not in this node_modules' % name)
        continue
    if package.get('versions'):
        package['md5'] = next(
            (digest for digest in package['versions'].values() if digest == md5_of(installed_file)), 'not a known version',
        )
        installed_version = next(
            (version for version, digest in package['versions'].items() if digest == md5_of(installed_file)), None,
        )
    if package.get('versions') and installed_version is None:
        continue
    if md5_of(installed_file) != package['md5']:
        print(
            '--   %-42s md5     %s is %s, and the types were written for %s. This is another version: move the types over with '
            'tools/carry_over.py, then run every gate again' % (
                name, package['npm'], md5_of(installed_file)[:8], package['md5'][:8],
            )
        )
        continue
    report(True, name, 'md5', package['md5'][:8] + (' (version %s)' % installed_version if package.get('versions') else ''))
    work = OUT + '/work/' + name
    shutil.copytree(source, work)
    if package.get('versions') and installed_version != package['token']:
        text = open(work + '/' + typed_file).read()
        open(work + '/' + typed_file, 'w').write(
            text.replace('"' + package['token'] + '"', '"' + installed_version + '"')
            .replace('react-dom:  ' + package['token'], 'react-dom:  ' + installed_version)
        )
    code, output = run([SEMA, 'cli', typed_file, '--noEmit', '--all'], work)
    report(
        'No type errors' in output, name, 'errors',
        'none' if 'No type errors' in output else (re.search(r'Found [\d,]+ errors?', output) or ['no result'])[0],
    )
    os.makedirs(work + '/verify')
    shutil.copy(installed_file, work + '/verify/a.' + extensions[0])
    open(work + '/verify/b.' + extensions[1], 'w').write(erase_markers(open(work + '/' + typed_file).read()))
    expected_lines, actual_lines = (
        printed_lines('a.' + extensions[0], work + '/verify'), printed_lines('b.' + extensions[1], work + '/verify'),
    )
    report(
        bool(actual_lines) and expected_lines == actual_lines, name, 'verify',
        "prints as npm's file does (%d lines)" % len(expected_lines) if actual_lines and expected_lines == actual_lines
        else 'differs at printed line %d' % (
            next(
                (
                    index for index in range(min(len(expected_lines), len(actual_lines)))
                    if expected_lines[index] != actual_lines[index]
                ),
                min(len(expected_lines), len(actual_lines)),
            ) + 1
        ),
    )
    if package['form'] == 'esm':
        code, output = 0, (
            'splits1: the file is not minified, so no variable has a second role: 0 variants\n'
            'splits1: nothing to prove: 0 captured'
            if not re.search(r'\$as[A-Z]|\$given\b', open(work + '/' + typed_file).read())
            else 'splits1: the file has a `$as<Role>` or `$given` suffix, and it should have none\nsplits1: FAIL'
        )
    else:
        code, output = run([sys.executable, '-I', TOOLS + '/splits1.py', work + '/typed.cts', work + '/splits', SEMA])
    last_line = output.strip().split('\n')[-1]
    first_line = output.strip().split('\n')[0]
    report(
        code == 0 and '0 captured' in last_line, name, 'splits',
        first_line.replace('splits1: ', '') + ' · ' + last_line.replace('splits1: ', ''),
    )
    variants = re.search(r'(\d+) variants', first_line)
    report(
        bool(variants) and package['expected']['variants'] in (None, int(variants.group(1))), name, 'counts',
        'variants %s (expected %s) · as any %d · : any %d · as unknown as %d · other casts %d · ! %d' % (
            (variants.group(1) if variants else '?', package['expected']['variants'])
            + (lambda text: (
                len(re.findall(r'\bas any\b', text)),
                len(re.findall(r':\s*any\b', text)),
                len(re.findall(r'as unknown as', text)),
                len(re.findall(r'\bas (?!any\b|unknown\b)[A-Z]', text)),
                len(re.findall(r'[\w)\]]!(?=[.\[(,;) ])', text)),
            ))(open(work + '/' + typed_file).read())
        ),
    )
    fields_code, fields_output = run([sys.executable, '-I', TOOLS + '/declare_fields.py', work + '/' + typed_file, '--check'])
    report(not fields_code, name, 'fields', fields_output.strip().replace('declare_fields: ', ''))
    laid_folder = OUT + '/laid/' + name
    os.makedirs(laid_folder)
    generated = laid_folder + '/' + os.path.basename(package['lay'])
    if package['form'] == 'reconciler':
        form_code, form_output = run([
            sys.executable, '-I', TOOLS + '/module_form8.py', work + '/typed.cts', work + '/formed.ts', '--opaque=index',
        ])
        any_code, any_output = run([
            sys.executable, '-I', TOOLS + '/given2.py', work + '/formed.ts', work + '/given.ts', '--mode=any', '--doors=any',
            '--live=' + EXEMPT_INTERFACES + ('' if ELEMENTS == 'plain' else ',ReactElement'),
        ])
        if ELEMENTS == 'plain':
            shutil.copy(work + '/given.ts', generated)
            elements_code, elements_output = 0, 'elements are `any` (plain)'
        else:
            elements_code, elements_output = run([
                sys.executable, '-I', TOOLS + '/share_elements1.py', work + '/given.ts', generated, '--react=../../react',
            ])
        report(
            not (form_code or any_code or elements_code) and 'yes' in form_output, name, 'form',
            form_output.strip()[-60:] + ' · ' + any_output.strip()[:70] + ' · ' + elements_output.strip()[:70],
        )
    elif package['form'] == 'esm':
        form_code, form_output = run([sys.executable, '-I', TOOLS + '/form_esm1.py', work + '/' + typed_file, generated])
        report(not form_code and 'yes' in form_output, name, 'form', form_output.strip()[-110:])
    else:
        form_code, form_output = run([sys.executable, '-I', TOOLS + '/module_form8.py', work + '/typed.cts', generated])
        report(not form_code and 'yes' in form_output, name, 'form', form_output.strip()[-110:])
    shutil.move(generated, work + '/formed.with.notes.ts')
    clean_code, clean_output = run([sys.executable, '-I', TOOLS + '/clean_lay.py', work + '/formed.with.notes.ts', generated])
    report(not clean_code, name, 'clean', clean_output.strip()[-90:])
    if package.get('skipped') and not (options.get('only') and options['only'] in name):
        print('--   %-42s laid    %s' % (name, package['skipped']))
        continue
    if package['form'] == 'placed':
        text = re.sub(
            r'^/// <reference[^\n]*\n', '', open(work + '/' + typed_file).read().replace('/*$*/', ''), flags=re.M,
        ).rstrip('\n') + '\n'
        declarations = open(generated).read()
        declarations = declarations[declarations.index('\nnamespace ' + package['space'] + ' {') + 1:]
        package_name, path = package['npm'].split('/', 1)
        os.makedirs(os.path.dirname(OUT + '/sound/' + package_name + '/lay/' + path), exist_ok=True)
        open(work + '/placed.cts', 'w').write(text + declarations)
        open(OUT + '/sound/' + package_name + '/lay/' + path, 'w').write(
            text + re.sub(r'^declare var (require|exports)\b[^\n]*\n', '', declarations, flags=re.M)
        )
        placed_bundles.setdefault(package_name, {})[path] = hashlib.sha256(open(installed_file, 'rb').read()).hexdigest()
        generated_files.append((name, work + '/placed.cts'))
        continue
    # Apache-2.0 4(b) asks for a prominent notice in a changed file. It goes on the first line, which is blank (a
    # /// <reference> was there), so no line moves.
    if package.get('changed'):
        text = open(generated).read()
        report(text.startswith('\n'), name, 'changed', 'the file says on its first line that it was changed')
        open(generated, 'w').write(package['changed'] + text)
    shutil.copy(generated, OUT + '/node_modules/' + package['lay'])
    generated_files.append((name, package['lay']))
    for file, entry_text in package['entries'].items():
        if package['form'] == 'esm':
            open(OUT + '/node_modules/' + file, 'w').write(entry_text + '\n')
            continue
        entry_code, entry_output = run([
            sys.executable, '-I', TOOLS + '/cjs_entry.py', INSTALLED + '/' + file, OUT + '/node_modules/' + file,
            os.path.basename(package['lay'])[:-3],
        ])
        exports_lines = [
            line[2:] for line in open(generated).read().split('\n')
            if re.match(
                r'//(module\.exports\.default = module\.exports;|Object\.defineProperty\(module\.exports, "__esModule")', line,
            )
        ]
        # The bundle's last lines change module.exports. An ES module cannot, so the entry point does it.
        if exports_lines:
            open(OUT + '/node_modules/' + file, 'a').write('\n'.join(exports_lines) + '\n')
        report(not entry_code, name, 'entry', '%s: %s%s' % (
            file, entry_output.strip()[-90:],
            " · plus the bundle's %d lines that change module.exports" % len(exports_lines) if exports_lines else '',
        ))
    if package['form'] == 'reconciler':
        for file, (installed_path, digest, generated_path, entry, entry_text) in SMALL_FILES.items():
            if file == 'react-jsx-runtime.ts' and ELEMENTS == 'plain':
                continue
            is_expected = (
                os.path.exists(INSTALLED + '/' + installed_path) and md5_of(INSTALLED + '/' + installed_path) == digest
            )
            report(is_expected, name, 'md5', '%s %s' % (installed_path, digest[:8]))
            if is_expected:
                os.makedirs(work + '/small.' + file)
                shutil.copy(INSTALLED + '/' + installed_path, work + '/small.' + file + '/a.cjs')
                small_file = (
                    source + '/small/' + file if os.path.exists(source + '/small/' + file)
                    else HERE + '/react/19.2.0/src/' + file
                )
                shutil.copy(small_file, laid_folder + '/' + file)
                shutil.copy(small_file, OUT + '/node_modules/' + generated_path)
                entry_code, entry_output = run([
                    sys.executable, '-I', TOOLS + '/cjs_entry.py', INSTALLED + '/' + entry, OUT + '/node_modules/' + entry,
                    os.path.basename(generated_path)[:-3],
                ])
                report(not entry_code, name, 'entry', '%s: %s' % (entry, entry_output.strip()[-90:]))
                generated_files.append((name, generated_path))

for package in MODULE_PACKAGES:
    name = package['name'] + '@' + package['version']
    source = (
        os.environ['SHIP_PACKAGES'] + '/' + package['folder'] if os.environ.get('SHIP_PACKAGES')
        else HERE + '/packages/' + package['folder'] if os.path.isdir(HERE + '/packages/' + package['folder'])
        else HERE + '/' + package['src']
    )
    installed_folder = INSTALLED + '/' + package['name']
    copied_folder = OUT + '/node_modules/' + package['name']
    if (options.get('only') and options['only'] not in name) or not os.path.isdir(source):
        continue
    if not os.path.isdir(installed_folder):
        print('--   %-42s         not in this node_modules' % name)
        continue
    different = [
        file for file, digest in package['files'].items()
        if not os.path.exists(installed_folder + '/' + file + '.mjs')
        or md5_of(installed_folder + '/' + file + '.mjs') != digest
    ]
    if different:
        print('--   %-42s md5     %s.mjs is not the file that the types were written for: this is another version' % (
            name, different[0],
        ))
        continue
    report(True, name, 'md5', '%d files' % len(package['files']))
    work = OUT + '/work/' + package['folder']
    os.makedirs(work + '/verify')
    for number, file in enumerate(sorted(package['files'])):
        text = open(source + '/' + file + '.sound.mts').read()
        shutil.copy(installed_folder + '/' + file + '.mjs', work + '/verify/a%d.mjs' % number)
        open(work + '/verify/b%d.mts' % number, 'w').write(erase_markers(text))
        expected_lines, actual_lines = (
            printed_lines('a%d.mjs' % number, work + '/verify'), printed_lines('b%d.mts' % number, work + '/verify'),
        )
        report(bool(actual_lines) and expected_lines == actual_lines, name, 'verify', '%s: %s' % (
            file,
            "prints as npm's file does (%d lines)" % len(expected_lines) if actual_lines and expected_lines == actual_lines
            else 'differs',
        ))
        fields_code, fields_output = run([
            sys.executable, '-I', TOOLS + '/declare_fields.py', source + '/' + file + '.sound.mts', '--check',
        ])
        report(not fields_code, name, 'fields', file + ': ' + fields_output.strip().replace('declare_fields: ', ''))
        generated_text = text.replace('/*$*/', '')
        rewritten = 0
        for other_file in package['files']:
            path = os.path.relpath(other_file, os.path.dirname(file))
            path = path if path.startswith('.') else './' + path
            rewritten += generated_text.count('from "%s.mjs"' % path)
            generated_text = generated_text.replace('from "%s.mjs"' % path, 'from "%s.sound.mts"' % path)
        open(copied_folder + '/' + file + '.sound.mts', 'w').write(generated_text)
        open(copied_folder + '/' + file + '.mjs', 'w').write('export * from "./%s.sound.mts";\n' % os.path.basename(file))
        report(True, name, 'form', '%s: %d imports rewritten to typed files' % (file, rewritten))
        generated_files.append((name, package['name'] + '/' + file + '.sound.mts'))


def write_manifest(package_name, version, lay):
    written = OUT + '/sound/' + package_name
    committed = HERE + '/' + package_name + '/' + version
    json.dump(
        {'sound': 2, 'name': package_name, 'version': version, 'when': {}, 'basis': {}, 'lay': lay, 'needs': []},
        open(written + '/sound.json', 'w'), indent=2,
    )
    open(written + '/sound.json', 'a').write('\n')
    if not os.path.exists(committed + '/sound.json'):
        return
    if any('one-name' in folders for _, folders, _ in os.walk(committed + '/src')):
        print('--   %-42s same    one_name.py makes lay/ from the same src/, and has its own gates' % (package_name + '@' + version))
        return
    committed_files = sorted(
        os.path.relpath(os.path.join(folder, file), committed + '/lay')
        for folder, _, files in os.walk(committed + '/lay') for file in files
    )
    different = (
        [
            file for file in committed_files
            if file not in lay or open(committed + '/lay/' + file, 'rb').read() != open(written + '/lay/' + file, 'rb').read()
        ]
        + [file for file in lay if committed_files and file not in committed_files]
        + (['sound.json'] if open(committed + '/sound.json').read() != open(written + '/sound.json').read() else [])
        + (
            ['lay.sums']
            if open(committed + '/lay.sums').read() != ''.join(
                '%s  %s\n' % (hashlib.sha256(open(written + '/lay/' + file, 'rb').read()).hexdigest(), file)
                for file in sorted(lay)
            )
            else []
        )
    )
    report(
        not different, package_name + '@' + version, 'same',
        '%slay.sums and sound.json are what src/ generates (%d files)' % ('lay/, ' if committed_files else '', len(lay))
        if not different else 'differs: ' + ' '.join(different),
    )


for package_name, placed_files in PLACED.items():
    if (options.get('only') and options['only'] not in package_name) or not os.path.isdir(INSTALLED + '/' + package_name):
        continue
    version = json.load(open(INSTALLED + '/' + package_name + '/package.json'))['version']
    name = package_name + '@' + version
    work = OUT + '/work/' + package_name + '.placed'
    written = OUT + '/sound/' + package_name
    os.makedirs(work + '/verify')
    lay = {}
    open(work + '/commonjs.d.ts', 'w').write(
        'declare var exports: any;\ndeclare var module: any;\ndeclare function require(name: string): any;\n'
    )
    for number, placed_file in enumerate(placed_files):
        installed_file = INSTALLED + '/' + package_name + '/' + placed_file['npm']
        if not os.path.exists(installed_file) or md5_of(installed_file) != placed_file['md5']:
            print('--   %-42s md5     %s is not the file that the types were written for' % (name, placed_file['npm']))
            continue
        report(True, name, 'md5', '%s %s' % (placed_file['npm'], placed_file['md5'][:8]))
        text = open(HERE + '/' + placed_file['text']).read()
        file = os.path.basename(placed_file['text'])
        open(work + '/' + file, 'w').write('/// <reference path="./commonjs.d.ts" />\n' + text)
        code, output = run([SEMA, 'cli', file, '--noEmit', '--all'], work)
        report('No type errors' in output, name, 'errors', '%s: %s' % (
            file, 'none' if 'No type errors' in output else (re.search(r'Found [\d,]+ errors?', output) or ['no result'])[0],
        ))
        shutil.copy(installed_file, work + '/verify/a%d.cjs' % number)
        open(work + '/verify/b%d.cts' % number, 'w').write(erase_markers(text))
        expected_lines, actual_lines = (
            printed_lines('a%d.cjs' % number, work + '/verify'), printed_lines('b%d.cts' % number, work + '/verify'),
        )
        report(bool(actual_lines) and expected_lines == actual_lines, name, 'verify', '%s: %s' % (
            file,
            "prints as npm's file does (%d lines)" % len(expected_lines) if actual_lines and expected_lines == actual_lines
            else 'differs',
        ))
        os.makedirs(os.path.dirname(written + '/lay/' + placed_file['npm']), exist_ok=True)
        open(written + '/lay/' + placed_file['npm'], 'w').write(text.replace('/*$*/', ''))
        lay[placed_file['npm']] = hashlib.sha256(open(installed_file, 'rb').read()).hexdigest()
    if lay:
        write_manifest(package_name, version, lay)
for package_name, lay in placed_bundles.items():
    write_manifest(
        package_name, json.load(open(INSTALLED + '/' + package_name + '/package.json'))['version'], dict(sorted(lay.items())),
    )

LIBRARIES = {package['name'] + '@' + package['version']: package['lib'] for package in MODULE_PACKAGES}
BUILD_FLAGS = ['--aot', '--aot-out=' + os.devnull]
for name, file in generated_files:
    path = os.path.join(OUT + '/node_modules', file)
    code, output = run(
        [SEMA, 'cli', os.path.basename(file), '--noEmit', '--all', '--strict'] + BUILD_FLAGS
        + (['--lib', LIBRARIES[name]] if name in LIBRARIES else []),
        os.path.dirname(path),
    )
    lines = open(path, errors='replace').read().split('\n')
    if not re.search(r'No type errors|Found [\d,]+ error', output):
        report(False, name, 'laid', file + ': no result')
        continue
    errors = [
        (match.group(1), match.group(2), int(match.group(3)))
        for match in re.finditer(r'^error: (TS\d+):.*?\n\s+at (\S+?):(\d+)', output, re.S | re.M)
    ]
    total = len(re.findall(r'^error: ', output, re.M))
    # A module of the package that ships no declarations (tslib.mjs) is `any`.
    ignored = [
        error for error in errors
        if error[0] == 'TS7016' and name in LIBRARIES
        or error[1].endswith(os.path.basename(file))
        and re.fullmatch(r'import \* as [\w$]+\$module from "[^"]+";', lines[error[2] - 1].strip())
    ]
    report(total == len(ignored), name, 'laid', '%s: %d errors%s' % (
        file, total - len(ignored),
        ' (plus %d on appended imports, ignored: %s)' % (len(ignored), ' '.join(sorted({error[0] for error in ignored})))
        if ignored else '',
    ))

for name, file in generated_files:
    path = os.path.join(OUT + '/node_modules', file)
    counts = []
    for label, flags in (
        ('noImplicitAny false', ['--strict', '--noImplicitAny=false']),
        ('strictNullChecks false', ['--strict', '--strictNullChecks=false']),
        ('strict false', ['--strict=false']),
    ):
        code, output = run(
            [SEMA, 'cli', os.path.basename(file), '--noEmit', '--all'] + flags + BUILD_FLAGS
            + (['--lib', LIBRARIES[name]] if name in LIBRARIES else []),
            os.path.dirname(path),
        )
        counts.append((
            label,
            len([
                number for number in re.findall(r'^error: (TS\d+)', output, re.M)
                if number not in ('TS7016', 'TS2591', 'TS2307')
            ])
            if re.search(r'No type errors|Found [\d,]+ error', output) else -1,
        ))
    report(not any(count for _, count in counts), name, 'lax', '%s: %s' % (
        os.path.basename(file), ' · '.join('%s %d' % pair for pair in counts),
    ))

for package_name in sorted({
    '/'.join(file.split('/')[:2 if file.startswith('@') else 1]) for _, file in generated_files if not file.startswith('/')
}):
    for version in sorted(os.listdir(HERE + '/' + package_name)) if os.path.isdir(HERE + '/' + package_name) else []:
        committed = HERE + '/' + package_name + '/' + version
        if (
            not os.path.exists(committed + '/sound.json')
            or json.load(open(INSTALLED + '/' + package_name + '/package.json'))['version'] != version
        ):
            continue
        manifest = json.load(open(committed + '/sound.json'))
        if manifest['sound'] == 2:
            print('--   %-42s same    lay/ is in format 2: one_name.py makes it from the same src/, and has its own gates' % (
                package_name + '@' + version,
            ))
            continue
        sha256_of = lambda path: hashlib.sha256(open(path, 'rb').read()).hexdigest()
        # A version that shares another version's typed file has no lay/ in the repository. publish.py generates it, and
        # lay.sums pins the result.
        sums = (
            dict(reversed(line.split('  ', 1)) for line in open(committed + '/lay.sums').read().split('\n') if line)
            if os.path.exists(committed + '/lay.sums') else None
        )
        different = [
            file for file in manifest['lay']
            if not os.path.exists(OUT + '/node_modules/' + package_name + '/' + file)
            or (
                sha256_of(OUT + '/node_modules/' + package_name + '/' + file) != sums.get(file) if sums is not None
                else open(committed + '/lay/' + file, 'rb').read()
                != open(OUT + '/node_modules/' + package_name + '/' + file, 'rb').read()
            )
        ]
        different += [
            file for file, digest in list(manifest['lay'].items()) + list(manifest['basis'].items())
            if (digest == 'new') == os.path.exists(INSTALLED + '/' + package_name + '/' + file)
            or digest != 'new' and sha256_of(INSTALLED + '/' + package_name + '/' + file) != digest
        ]
        report(
            not different, package_name + '@' + version, 'same',
            ('lay.sums' if sums is not None else 'lay/')
            + ' is what src/ generates (%d files), and the sha256 sums are those of the installed files (%d)' % (
                len(manifest['lay']), len(manifest['lay']) + len(manifest['basis']),
            )
            if not different else 'differs: ' + ' '.join(different[:4]),
        )

print('check.py: %s · elements %s · build against %s/node_modules' % (
    'every gate passed' if not failures else '%d gates failed' % failures, ELEMENTS, OUT,
))
sys.exit(1 if failures else 0)
