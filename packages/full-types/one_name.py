#!/usr/bin/env python3
"""usage: one_name.py <node_modules> <name>/<version> <work folder> [--write]

Makes lay/ in format 2 from the typed text under src/. Runs no package code.

A PACKAGE THAT IS TYPED FILE BY FILE (@anthropic-ai/sdk): src/<path>.sound.mts is npm's <path>.mjs with types added. It goes to
lay/<path>.mjs without its /*$*/ markers. The gates are those below, from `strict` on, with plain `bun check`: the texts stand
beside npm's files, where a build would load `./x.mjs` itself and not its typed neighbor.

A MODULE WITHOUT REUSED VARIABLES (seroval): src/typed.mts goes to lay/ without its markers, with its declarations behind it, and
through `index` and `numbers` below.

A BUNDLE (react-reconciler, react-dom's two server bundles):

The typed text under src/ was written for a compiler that took more than types: a variable that the minifier reuses for
values of several types is split there into one variable a role (`x$asFiber`, `x$asLanes`, `x$given`), declared between
/*$*/ markers. Today's compiler compares the full-types file with the installed one node for node, so each variable has to have
its one name again:

  merge    tools/merge_roles.py: the role variables go, and the one variable is declared with the union of their types.
           one-name/extra.json names members of a union that no role names.
  given    tools/probe_given.py: what each read of a reused parameter holds: what was given, or a type that the checker
           names (one-name/given_roles.json: made once, kept; tools/take_named.py puts those types into extra.json).
  reads    tools/fix_reads.py, tools/probe_reads.py: TypeScript narrows a union by assignment, which gives most reads the type
           of their role. Where it does not, the read gets `!` or a cast to that type. A read that is wider than its role
           without being an error (`update.next` on `Update | FiberRoot`) is found with `(x satisfies Role)`.
  patches  tools/patch_text.py: what no tool decides, by hand: one-name/patches.before.json (before `reads`) and
           patches.json (after it). Each replacement has to fit exactly once.
  index    tools/bang_index.py: `!` behind an element read where noUncheckedIndexedAccess would report an error.
  numbers  An int32 keeps its proof in a reused variable whose other roles are objects. Where another role is a number or `any`
           it cannot be proven, and every build warns of a file with an int32 that is not proven (TS100066): the types under
           `numbers` in the table below become `number`. One variable or parameter alone: patches.json.

The folder one-name/ lies beside typed.cts.

The gates:
  md5      npm's file is the one that the types were written for.
  strict   The checker of a build reports no type error under `strict`: `bun check --aot` with the text as the entry point.
           There `new F(..)` has the type that F declares for `this`. What the text requires is loaded from <node_modules>.
  more     Nor under noUncheckedIndexedAccess, exactOptionalPropertyTypes, noImplicitOverride and useUnknownInCatchVariables.
  proven   A program that has the text as a file of a package gets no warning about it: each int32 is proven, or the value that
           enters it is written `e as int32`, which is the author's word for e and is tested when the program runs.
  verify   Without its types the text prints as npm's file does, line for line. Bun prints both.
  lines    Line n of the text is line n of npm's file with types added: tools/carry_patch.py relies on it.
  same     lay/, lay.sums and full-types.json in the repository are what this run made. --write writes them instead.

Environment: BUN, a Bun that has `bun check --aot`. Default: bun"""
import glob, hashlib, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = HERE + '/tools'
BUN = shutil.which(os.environ.get('BUN', 'bun')) or sys.exit('one_name.py: set BUN=<a Bun that has `bun check --aot`>')
BUN = os.path.abspath(BUN)
arguments = [argument for argument in sys.argv[1:] if not argument.startswith('--')]
if len(arguments) != 3:
    sys.exit(__doc__)
INSTALLED, VERSION_FOLDER, WORK = os.path.abspath(arguments[0]), arguments[1].strip('/'), os.path.abspath(arguments[2])
WRITES = '--write' in sys.argv

# space    the namespace of the declarations
# file     npm's file, which the typed text replaces
# md5      of npm's file
# source   the folder of typed.cts under src/
# numbers  the aliases of int32 that become `number`; 'int32' stands for every use of int32 itself
# text     the typed text, if it is not typed.cts. A text that is no .cts has no variable with roles
SERVER_NUMBERS = ['SegmentId', 'ChildIndex', 'ChunkIndex', 'ContextDepth', 'HookCounter', 'int32']
BUNDLES = {
    'react-reconciler/0.33.0': [
        dict(space='RR', file='cjs/react-reconciler.production.js', md5='1ce09a736d5c21646595d20964d9b01d', source='', numbers=[]),
    ],
    'seroval/1.6.9': [
        dict(
            space='SV', file='dist/index.js', md5='ccbd09502b548d78881f2353cf209c2b', source='', text='typed.mts',
            numbers=['TemporalType', 'ErrorTag', 'SymbolTag', 'SpecialRef', 'ConstantTag', 'NodeLength'],
        ),
    ],
    'react-dom/19.3.0': [
        dict(
            space='FZ', file='cjs/react-dom-server-legacy.browser.production.js', md5='2b8f4172ffbe52177acfc592892704c5',
            source='/server-legacy.browser', numbers=SERVER_NUMBERS,
        ),
        dict(
            space='FZ', file='cjs/react-dom-server.bun.production.js', md5='e6c2b1151664227396c16e5217ae9e4b',
            source='/server.bun', numbers=SERVER_NUMBERS,
        ),
    ],
    'react-dom/19.3.1': [
        dict(
            space='FZ', file='cjs/react-dom-server-legacy.browser.production.js', md5='4896a582e13f60a195b4a97bfed10db7',
            source='/server-legacy.browser', numbers=SERVER_NUMBERS,
        ),
        dict(
            space='FZ', file='cjs/react-dom-server.bun.production.js', md5='18d04fee389023d0b4c6844de16c5317',
            source='/server.bun', numbers=SERVER_NUMBERS,
        ),
    ],
}
# The files of a package that is full-types file by file, without `.mjs`.
FILE_BY_FILE = {
    '@anthropic-ai/sdk/0.112.1': ['core/streaming', 'internal/decoders/line', 'internal/tslib', 'internal/utils/bytes'],
    '@anthropic-ai/sdk/0.128.0': ['core/streaming', 'internal/decoders/line', 'internal/tslib', 'internal/utils/bytes'],
}
if VERSION_FOLDER not in BUNDLES and VERSION_FOLDER not in FILE_BY_FILE:
    sys.exit('one_name.py: no such folder. There are: ' + ' '.join(list(BUNDLES) + list(FILE_BY_FILE)))
NAME, VERSION = VERSION_FOLDER.rsplit('/', 1)
COMMITTED = HERE + '/' + VERSION_FOLDER
SOURCE = COMMITTED + '/src'
ENV = dict(os.environ, NO_COLOR='1')
STRICT = dict(target='esnext', module='esnext', moduleResolution='bundler', strict=True, skipLibCheck=True, noEmit=True, types=[], lib=['esnext'])
MORE = dict(noUncheckedIndexedAccess=True, exactOptionalPropertyTypes=True, noImplicitOverride=True, useUnknownInCatchVariables=True)
failures = 0


def report(passed, gate, message):
    global failures
    failures += not passed
    print('%-4s %-28s %-7s %s' % ('ok' if passed else 'FAIL', VERSION_FOLDER, gate, message))


def tool(name, *rest):
    result = subprocess.run([sys.executable, '-I', TOOLS + '/' + name] + list(rest), env=ENV, capture_output=True, text=True)
    if result.returncode:
        sys.exit('one_name.py: %s failed:\n%s%s' % (name, result.stdout[-2000:], result.stderr[-2000:]))
    return result.stdout


def project(folder, options, name='text.cts'):
    os.makedirs(folder)
    os.symlink(INSTALLED, folder + '/node_modules')
    open(folder + '/bun.d.ts', 'w').write('declare module "bun" { type int32 = number & { readonly "bun.int32"?: true }; }\n')
    # The probes copy this file into folders of their own below this one, beside a text of the same name.
    json.dump({'compilerOptions': options, 'files': [name, folder + '/bun.d.ts']}, open(folder + '/tsconfig.json', 'w'))
    return folder


# With an entry point: what a build of it reports. Without: what plain `bun check` reports for the folder's tsconfig.json.
def errors_in(folder, entry_point=None):
    build = ['--aot', '--define', 'process.env.NODE_ENV="production"', entry_point] if entry_point else []
    result = subprocess.run([BUN, 'check', '--all', '--no-pretty'] + build, cwd=folder, env=ENV, capture_output=True, text=True)
    lines = [line for line in (result.stdout + result.stderr).split('\n') if line.strip()]
    errors = [line for line in lines if ': error TS' in line]
    if result.returncode and not errors:
        return ['the checker stopped with exit code %d and named no type error:' % result.returncode] + lines[-8:]
    return errors


# What a program is told about the text when the text is a file of one of its packages.
def said_to_program(folder, name):
    program = folder + '/program'
    package = program + '/node_modules/full-types-under-test'
    os.makedirs(package)
    shutil.copy(folder + '/' + name, package + '/' + name)
    json.dump({'name': 'full-types-under-test', 'version': '1.0.0', 'main': name}, open(package + '/package.json', 'w'))
    open(program + '/entry.ts', 'w').write('import * as all from "full-types-under-test";\nconsole.log(typeof all);\n')
    build = ['--aot', '--define', 'process.env.NODE_ENV="production"', 'entry.ts']
    result = subprocess.run([BUN, 'check', '--no-pretty'] + build, cwd=program, env=ENV, capture_output=True, text=True)
    lines = [line for line in (result.stdout + result.stderr).split('\n') if re.search(r'\bTS\d+:', line)]
    return lines if lines or not result.returncode else ['the checker stopped with exit code %d' % result.returncode]


def printed_lines(path, cwd):
    result = subprocess.run([BUN, 'build', '--no-bundle', '--target=bun', path], cwd=cwd, capture_output=True, text=True)
    return [line for line in result.stdout.split('\n') if line.strip()]


def finish(lay, installed):
    sha256 = lambda data: hashlib.sha256(data).hexdigest()
    manifest = json.dumps({
        'format': 2, 'name': NAME, 'version': VERSION, 'when': {}, 'basis': {},
        'lay': {path: sha256(installed[path]) for path in sorted(lay)}, 'needs': [],
    }, indent=2) + '\n'
    files = {'lay/' + path: text for path, text in lay.items()}
    files['lay.sums'] = ''.join('%s  %s\n' % (sha256(lay[path].encode()), path) for path in sorted(lay))
    files['full-types.json'] = manifest
    if WRITES and not failures:
        for path, content in files.items():
            os.makedirs(os.path.dirname(COMMITTED + '/' + path), exist_ok=True)
            open(COMMITTED + '/' + path, 'wb').write(content.encode())
        print('--   wrote ' + ' '.join(files))
    else:
        different = [
            path for path, content in files.items()
            if not os.path.exists(COMMITTED + '/' + path) or open(COMMITTED + '/' + path, 'rb').read() != content.encode()
        ]
        different += [
            'lay/' + os.path.relpath(os.path.join(folder, file), COMMITTED + '/lay')
            for folder, _, names in os.walk(COMMITTED + '/lay') for file in names
            if os.path.relpath(os.path.join(folder, file), COMMITTED + '/lay') not in lay
        ]
        report(not different, 'same', 'lay/, lay.sums and full-types.json are what src/ gives' if not different else 'differs: ' + ' '.join(different))
    print('one_name.py: %s' % ('every gate passed' if not failures else '%d gates failed' % failures))
    sys.exit(1 if failures else 0)


if os.path.exists(WORK):
    sys.exit('one_name.py: %s exists. Name another folder: one_name.py removes nothing' % WORK)

if VERSION_FOLDER in FILE_BY_FILE:
    paths = FILE_BY_FILE[VERSION_FOLDER]
    lay = {path + '.mjs': open(SOURCE + '/' + path + '.sound.mts').read().replace('/*$*/', '') for path in paths}
    installed = {path: open(INSTALLED + '/' + NAME + '/' + path, 'rb').read() for path in lay}
    for gate, options in (('strict', {}), ('more', MORE)):
        # Each text stands beside npm's file as <path>.mts, where `./x.mjs` finds a typed neighbor before the declarations of x.
        folder = WORK + '/' + gate
        shutil.copytree(INSTALLED + '/' + NAME, folder, symlinks=True, ignore=shutil.ignore_patterns('node_modules', 'src'))
        for path in paths:
            open(folder + '/' + path + '.mts', 'w').write(lay[path + '.mjs'])
        has_node_types = os.path.exists(INSTALLED + '/@types/node')
        json.dump({
            'compilerOptions': dict(
                STRICT, lib=['esnext', 'dom'], typeRoots=[INSTALLED + '/@types'], types=['node'] if has_node_types else [], **options,
            ),
            'files': [path + '.mts' for path in paths],
        }, open(folder + '/tsconfig.json', 'w'))
        errors = errors_in(folder)
        report(not errors, gate, '%d errors%s' % (len(errors), ''.join('\n     ' + error[:200] for error in errors[:10])))
    os.makedirs(WORK + '/verify')
    for number, path in enumerate(paths):
        open(WORK + '/verify/npm%d.mjs' % number, 'wb').write(installed[path + '.mjs'])
        open(WORK + '/verify/typed%d.mts' % number, 'w').write(lay[path + '.mjs'])
        expected, actual = printed_lines('npm%d.mjs' % number, WORK + '/verify'), printed_lines('typed%d.mts' % number, WORK + '/verify')
        report(bool(actual) and expected == actual, 'verify', "%s prints as npm's file does (%d lines)" % (path, len(expected)) if actual and expected == actual else path + ' differs')
    finish(lay, installed)

def without_comments(text):
    out, i = [], 0
    while i < len(text):
        character = text[i]
        if character in '"\'`':
            end = i + 1
            while end < len(text) and text[end] != character:
                end += 2 if text[end] == '\\' else 1
            out.append(text[i:end + 1])
            i = end + 1
        elif text.startswith('//', i):
            i = text.find('\n', i) if text.find('\n', i) >= 0 else len(text)
        elif text.startswith('/*', i):
            i = text.index('*/', i) + 2
        else:
            out.append(character)
            i += 1
    return '\n'.join(line.rstrip() for line in ''.join(out).split('\n') if line.strip()) + '\n'


def give_one_name(source, settings, strict, text, table, shapes):
    merge = lambda: tool('merge_roles.py', source + '/typed.cts', text, table, settings + '/extra.json', *shapes)
    if os.path.exists(settings + '/given_roles.json'):
        shutil.copy(settings + '/given_roles.json', strict + '/given_roles.json')
    else:
        merge()
        tool('probe_given.py', BUN, strict, strict + '/with_roles.ts', strict + '/given_candidates.json', strict + '/given_roles.json')
        print('--   given_roles.json is new: keep %s in one-name/, and run tools/take_named.py' % (strict + '/given_roles.json'))
    report(True, 'merge', merge().split('\n')[0])
    if os.path.exists(settings + '/patches.before.json'):
        tool('patch_text.py', text, settings + '/patches.before.json')
    tool('fix_reads.py', BUN, strict, 'text.cts', table, '14', '0')
    for turn in range(3):
        probed = tool('probe_reads.py', BUN, strict, 'text.cts', table).strip().split('\n')[-1]
        tool('fix_reads.py', BUN, strict, 'text.cts', table, '14', '0')
    report(True, 'reads', probed)
    tool('patch_text.py', text, settings + '/patches.json')


def make_bundle(bundle, work):
    ENV['NS'] = bundle['space']
    source = SOURCE + bundle['source']
    settings = source + '/one-name'
    npm_path = INSTALLED + '/' + NAME + '/' + bundle['file']
    npm_bytes = open(npm_path, 'rb').read()
    report(hashlib.md5(npm_bytes).hexdigest() == bundle['md5'], 'md5', bundle['file'])
    if failures:
        sys.exit(1)

    has_roles = 'text' not in bundle
    name = 'text.cts' if has_roles else 'text' + os.path.splitext(bundle['text'])[1]
    strict = project(work + '/strict', STRICT, name)
    prefix = bundle['space'].lower()
    shapes = sorted(glob.glob(source + '/' + prefix + '-shapes-*.d.ts')) + [source + '/' + prefix + '-shapes.d.ts']
    text, table = strict + '/' + name, strict + '/table.json'
    more = project(work + '/more', dict(STRICT, **MORE), name)
    if has_roles:
        give_one_name(source, settings, strict, text, table, shapes)
    else:
        written = re.sub(r'^/// <reference path="[^"]*" />\n', '', open(source + '/' + bundle['text']).read(), flags=re.M)
        declarations = ''.join(without_comments(open(shape).read()) for shape in shapes)
        open(text, 'w').write(written.replace('/*$*/', '').rstrip('\n') + '\n' + declarations)
    shutil.copy(text, more + '/' + name)
    report(True, 'index', tool('bang_index.py', BUN, more, name, bundle['space']).split('\n')[0])
    made = open(more + '/' + name).read()
    for alias in bundle['numbers']:
        if alias == 'int32':
            made = re.sub(r'\b%s\.int32\b' % bundle['space'], 'number', made)
            made = re.sub(r'([:|(] )int32\b', r'\1number', made)
        else:
            made, count = re.subn(r'^  type %s = int32;' % alias, '  type %s = number;' % alias, made, flags=re.M)
            report(count == 1, 'numbers', alias)
    for folder in (strict, more):
        open(folder + '/' + name, 'w').write(made)

    for gate, folder in (('strict', strict), ('more', more)):
        found = errors_in(folder, name)
        flows = [error for error in found if ': error TS100031: ' in error]
        errors = [error for error in found if error not in flows]
        report(not errors, gate, '%d errors%s' % (len(errors), ''.join('\n     ' + error[:200] for error in errors[:10])))
    said = said_to_program(strict, name)
    # As an entry point the text is the program's own, where `e as int32` needs the proof too: those are left out of the hints.
    hints = [flow for flow in flows if 'This expression is declared' not in flow and not re.search(r" as [^']*' might not be", flow)]
    report(not said, 'proven', '%d warnings%s' % (len(said), ''.join('\n     ' + line[:200] for line in said[:3] + hints[:20])))
    os.makedirs(work + '/verify')
    extension = os.path.splitext(name)[1]
    shutil.copy(npm_path, work + '/verify/npm' + extension.replace('t', 'j'))
    shutil.copy(text, work + '/verify/typed' + extension)
    expected = printed_lines('npm' + extension.replace('t', 'j'), work + '/verify')
    actual = printed_lines('typed' + extension, work + '/verify')
    report(bool(actual) and expected == actual, 'verify', "prints as npm's file does (%d lines)" % len(expected) if actual and expected == actual else 'differs')
    npm_lines = npm_bytes.decode().split('\n')
    report(
        made.split('\n')[len(npm_lines) - 2].strip() == npm_lines[-2].strip(), 'lines',
        "the %d lines of npm's file, then the declarations" % (len(npm_lines) - 1),
    )
    return made, npm_bytes


lay, installed = {}, {}
for number, bundle in enumerate(BUNDLES[VERSION_FOLDER]):
    lay[bundle['file']], installed[bundle['file']] = make_bundle(bundle, WORK + '/%d' % number)
finish(lay, installed)
