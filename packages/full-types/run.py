#!/usr/bin/env python3
"""usage: run.py build | answers <bun> <node_modules> <out folder> [--elements=shared|plain]

Checks that the full types in this folder behave like the packages npm installs, and that the compiler still uses their
types. <bun> is a build of Bun that has --aot. Each tree under trees/ is a program of scenarios that cover a package's public
API. A scenario runs in its own `try` and prints its results under a `== name` header, so one run shows every failure.

  trees/client    react and react-reconciler, on a host of its own (host2.ts)
  trees/server    react-dom/server: Bun's bundle, then every scenario again through the legacy bundle (arguments: "" string)
  trees/seroval   seroval, as three programs (see below)
  trees/sdk       @anthropic-ai/sdk
  trees/entries   what require(), a default import, a namespace import and named imports get from each replaced entry point
  trees/lie       a string where the type says number: shows that an audit build logs a mismatch

build    Runs no package code. Runs check.py, which writes the typed packages to <out>/node_modules. Then compiles each tree
         whose packages <node_modules> has, in <out>/projects/<tree>/<build>:
           untyped      your node_modules as it is
           typed        the typed packages
           typed.audit  the typed packages with --aot-type-errors=log: a value that does not match its type is logged to
                        stderr, and the program continues
         The entry points are compiled as `untyped`, `typed` and `control`, which is `bun build --compile` without --aot on the
         untouched packages. (`bun run` stops at an import of a name that a CommonJS entry point does not export. A bundle
         reads undefined.)
answers  Runs package code. Runs each tree with `bun run` on the untouched packages, twice, then runs every executable and
         compares the output section by section.

The compiler analyzes the entire program, so one call that passes parsed JSON to a package can open its layouts everywhere.
The tree of seroval is therefore three programs:
  <tree>           wide.ts as it is
  <tree>.internal  The text between /*C*/ marks is removed: the package only sees objects that it allocated.
  <tree>.boundary  The text between /*D*/ marks becomes `import { carry } from "./carried.js";` and the text between /*L*/
                   marks is removed: parsed JSON reaches the package only through an untyped file that is declared as
                   `carry<T>(x: T): T`, as when an untyped package calls it.

`answers` passes when
  - the audit build of trees/lie logs an `[aot] type-error` line and continues. If it does not, an audit build that logs
    nothing proves nothing;
  - `bun run` exits with 0, prints no THREW and prints the same text twice;
  - no section of any executable differs from `bun run`. A section whose header starts with `== 98 ` or `== 99 ` is known to
    differ: it is printed and not counted;
  - no executable logs an `[aot] type-error` line. In <tree> and <tree>.boundary parsed JSON reaches the package, so there the
    lines are not counted.

`build` also checks typedness. Full types can compile and give every right answer while the compiler no longer uses its
types. PINS has, by tree, the values that the compiler's own reports on the typed build are compared with:
  of              the package that is measured
  typed_percent   `dependencyPercent` of --explain=json: the share of the property accesses in node_modules that are a load or
                  a store at a fixed offset. Two points less fails.
  bytes           the image's map: the bytes of the package's compiled functions, typed over untyped. A tenth more fails.
  expected_open   --explain=json: the types that are open, which are the `types` of the causes whose `family` is `unknown-code`
                  or `unproven-type`. A class, a constructor function, an interface and a type alias have a name there.
                  Another name fails.
  regressed_open  types that were closed when the package was typed and are open with today's compiler. They are printed at
                  every run.
  unnamed_open    the number of causes that name no type, 0 unless pinned. Only an object type that was written without a
                  name has none. One more fails: a type that is not listed may then still be open.
  by              pins for one version of the package, by the start of its version
BUN_SOUND_PINS names a JSON file with more pins, { tree: { key: value } }, that is not in the repository.

Needs check.py's environment: SEMA, BUN, BUN_SEMA_TS_LIB. Exits with 1 if anything fails."""
import json
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ARGUMENTS = [argument for argument in sys.argv[1:] if not argument.startswith('--')]
CHECK_FLAGS = [argument for argument in sys.argv[1:] if argument.startswith('--')]
if len(ARGUMENTS) < 4:
    sys.exit(__doc__)
STEP = ARGUMENTS[0]
BUN, INSTALLED, OUT = (os.path.abspath(path) for path in ARGUMENTS[1:4])
TYPED = OUT + '/node_modules'
PROJECTS = OUT + '/projects'

ENV = dict(os.environ, NO_COLOR='1', BUN_ENABLE_CRASH_REPORTING='0', NODE_ENV='production', TZ='America/Los_Angeles')
AUDIT_FLAGS = ['--aot-type-errors=log']
PRODUCTION_FLAGS = ['--target=bun', '--define', 'process.env.NODE_ENV="production"']
AUDIT_LINE_PREFIX = '[aot] type-error '
BUILDS = (('untyped', INSTALLED, []), ('typed', TYPED, []), ('typed.audit', TYPED, AUDIT_FLAGS))
ENTRY_POINT_BUILDS = (('control', INSTALLED, []), ('untyped', INSTALLED, ['--aot']), ('typed', TYPED, ['--aot']))

TREES_WITH_VARIANTS = {'seroval': ['seroval']}
TREES = {
    'client': (['react', 'react-reconciler', 'scheduler'], [[]]),
    'server': (['react', 'react-dom'], [[], ['', 'string']]),
}
for name, packages in TREES_WITH_VARIANTS.items():
    for variant in ('', '.internal', '.boundary'):
        TREES[name + variant] = (packages, [[]])
TREES['sdk'] = (['@anthropic-ai/sdk'], [[]])

ENTRY_POINTS = (
    ('react-reconciler', 'react-reconciler'),
    ('react-compiler-runtime', 'react'),
    ('react-dom-server', 'react-dom'),
    ('seroval', 'seroval'),
)

SERVER_MODULES = (
    ('react', 'react/cjs/react.production.js'),
    ('react-dom', 'react-dom/cjs/react-dom.production.js'),
    ('react-dom/server', 'react-dom/server.bun.js'),
    ('react-dom/static', 'react-dom/static.node.js'),
)

# A plugin receives the contexts and returns nodes: serialize(node), onParse(node).
SEROVAL_OPEN = (
    'Sequence Stream AsyncParsePluginContext DeserializePluginContext SerializePluginContext StreamParsePluginContext '
    'SyncParsePluginContext Serializer SerovalNode ObjectRecord MapRecord'
)
PIN_KEYS = {'of', 'typed_percent', 'bytes', 'expected_open', 'regressed_open', 'unnamed_open', 'by'}
PINS = {
    'client': dict(
        of='react-reconciler',
        bytes=0.95,
        expected_open='AbortSignalLike AsyncDispatcher Dispatcher EffectInstance EventFunctionRef OffscreenProps',
        regressed_open=(
            'ActionStateQueue ActionStateQueueNode Cache CacheComponentState CapturedValue CaughtErrorInfo ConcurrentQueue '
            'ConcurrentUpdate ContextDependency Dependencies Effect ErrorInfo EventFunctionPayload Fiber FiberRoot '
            'FunctionComponentUpdateQueue Hook HookQueue HookUpdate HostNode HostText MemoCache OffscreenInstance '
            'OffscreenQueue OffscreenState PortalState ReactPortal RootState Selector SharedQueue SpawnedCachePool '
            'StoreConsistencyCheck StoreInstance SuspenseListRenderState SuspenseState TreeContext Update UpdateQueue'
        ),
    ),
    'server': dict(
        of='react-dom',
        expected_open=(
            'ComponentIdentity Ping RefObject PostponedHoles FormatContext ResumableState StylesheetResource '
            'ViewTransitionContext'
        ),
        by={'19.3.': dict(bytes=1.002)},
    ),
    'seroval.internal': dict(of='seroval', bytes=0.96, expected_open=SEROVAL_OPEN),
    'seroval.boundary': dict(of='seroval', bytes=0.967, expected_open=SEROVAL_OPEN),
    'sdk': dict(of='@anthropic-ai/sdk', expected_open='', by={'0.112.': dict(bytes=1.29), '0.128.': dict(bytes=1.015)}),
}

# tree -> patterns of audit lines that are expected. A pattern matches the entire line up to `; count`.
KNOWN_AUDIT_LINES = {}
# (tree, start of a section's header) -> why the section differs in the typed builds today. Every run prints it, or says that
# the section no longer differs.
KNOWN_FAILURES = {}
# tree -> why the untyped --aot build of the untouched package fails today.
KNOWN_UNTYPED_FAILURES = {}

failures = 0


def report(passed, message):
    global failures
    if not passed:
        failures += 1
    print(('ok   ' if passed else 'FAIL ') + message)


def fail(message):
    report(False, message)


def note(message):
    print('     ' + message)


def counted(count, noun):
    return '%d %s' % (count, noun if count == 1 else noun + 's')


def read(path):
    with open(path) as file:
        return file.read()


def write(path, text):
    with open(path, 'w') as file:
        file.write(text)


def run(command, cwd, env=ENV):
    return subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, errors='replace', stdin=subprocess.DEVNULL)


def is_executable(path):
    return os.access(path, os.X_OK)


def check_pin_keys(path, tree, pins):
    unknown = sorted(set(pins) - PIN_KEYS)
    if tree not in PINS or unknown:
        sys.exit('run.py: %s: %s: %s. The trees are %s, and the keys are %s' % (
            path, tree, 'unknown keys: ' + ' '.join(unknown) if tree in PINS else 'no such tree',
            ' '.join(PINS), ' '.join(sorted(PIN_KEYS))))
    for version_pins in pins.get('by', {}).values():
        check_pin_keys(path, tree, version_pins)


def load_private_pins(path):
    for tree, pins in json.loads(read(path)).items():
        check_pin_keys(path, tree, pins)
        PINS[tree].update(pins)


def pins_of(tree):
    pins = PINS[tree]
    version = json.loads(read('%s/%s/package.json' % (INSTALLED, pins['of'])))['version']
    for prefix, version_pins in pins.get('by', {}).items():
        if version.startswith(prefix):
            return dict(pins, **version_pins)
    return pins


def source_folder(tree):
    return tree.split('.')[0]


def has_variants(tree):
    return source_folder(tree) in TREES_WITH_VARIANTS


def entry_file(tree):
    return 'wide.ts' if has_variants(tree) or tree == 'sdk' else 'wide.tsx'


def replace_marked(mark, replacement, text):
    return re.sub(r'/\*%s\*/.*?/\*%s\*/' % (mark, mark), replacement, text, flags=re.S)


def variant_source(tree, text):
    if tree.endswith('.internal'):
        return replace_marked('C', '', text)
    if tree.endswith('.boundary'):
        return replace_marked('L', '', replace_marked('D', 'import { carry } from "./carried.js";', text))
    return text


# An older react-dom exports fewer names. A CommonJS entry point gives undefined for a name it does not export, and an ES
# module stops the build, so the tree declares each such name as a variable, in every build and under `bun run`.
def declare_missing_exports(project):
    text = read(project + '/wide.tsx')
    all_missing = []
    for module, file in SERVER_MODULES:
        exported = set(re.findall(r'^exports\.(\w+) = ', read('%s/%s' % (INSTALLED, file)), re.M))
        statement = re.search(r'^import \{([^}]*)\} from "%s";$' % module, text, re.M)
        names = [name.strip() for name in statement.group(1).replace('\n', ' ').split(',') if name.strip()]
        missing = [name for name in names if not name.startswith('type ') and name not in exported]
        if not missing:
            continue
        text = text.replace(statement.group(0), 'import { %s } from "%s"; var %s;' % (
            ', '.join(name for name in names if name not in missing), module,
            ', '.join('%s: typeof import("%s").%s' % (name, module, name) for name in missing)))
        all_missing += missing
    if all_missing:
        write(project + '/wide.tsx', text)
        write(project + '/../missing-exports.txt', ' '.join(all_missing))


def link_packages(project, modules):
    os.symlink(modules, project + '/node_modules')
    if modules != INSTALLED and os.path.isdir(OUT + '/sound'):
        shutil.copytree(OUT + '/sound', project + '/.full-types')


def create_project(tree, build, modules):
    project = '%s/%s/%s' % (PROJECTS, tree, build)
    os.makedirs(project)
    sources = '%s/trees/%s' % (HERE, source_folder(tree))
    for file in os.listdir(sources):
        if not file.startswith('carried.') or tree.endswith('.boundary'):
            shutil.copy('%s/%s' % (sources, file), project)
    if has_variants(tree):
        write(project + '/wide.ts', variant_source(tree, read(project + '/wide.ts')))
    if tree == 'server':
        declare_missing_exports(project)
    link_packages(project, modules)
    return project


def first_errors(output):
    return ' '.join(re.findall(r'.*(?:error|not compiled).*', output)[:3])[:300]


def check_open_types(tree, pins, causes):
    open_causes = [cause for cause in causes
                   if cause.get('family') in ('unknown-code', 'unproven-type') and cause.get('code') != 'by-name']
    unnamed = sum(1 for cause in open_causes if not cause['types'])
    pinned_unnamed = pins.get('unnamed_open', 0)
    open_types = {name for cause in open_causes for name in cause['types'] if re.fullmatch(r'[A-Z][\w$<>]*', name)}
    regressed = set(pins.get('regressed_open', '').split())
    new = sorted(open_types - set(pins['expected_open'].split()) - regressed)
    if regressed & open_types:
        note('%s: typedness: a known regression: these types were closed and are open: %s (why: --explain)' % (
            tree, ' '.join(sorted(regressed & open_types))))
    if new:
        fail('%s: typedness: these types are open now: %s (why: --explain)' % (tree, ' '.join(new)))
    if unnamed > pinned_unnamed:
        fail('%s: typedness: causes that name no type: %d (pinned %d). A type that is not listed may still be open. If each '
             'cause is about object types that were written without a name, pin `unnamed_open` (why: --explain)' % (
                 tree, unnamed, pinned_unnamed))
        return
    if unnamed < pinned_unnamed:
        note('%s: typedness: causes that name no type: %d (pinned %d): lower `unnamed_open` in run.py' % (
            tree, unnamed, pinned_unnamed))
    if regressed - open_types:
        note('%s: typedness: no longer listed as open: %s. Each is closed (then take it off `regressed_open` in run.py), or has '
             'no layout and is read by name (then typed_percent falls)' % (tree, ' '.join(sorted(regressed - open_types))))
    if not new:
        report(True, '%s: typedness: no type is open that was not (open: %d)' % (tree, len(open_types)))


# An F line of the map describes one compiled function: column 4 is its size, column 11 its file.
def compiled_bytes(map_file, package):
    if not os.path.exists(map_file):
        return 0
    total = 0
    with open(map_file, errors='replace') as lines:
        for line in lines:
            columns = line.rstrip('\n').split('\t')
            if columns[0] == 'F' and len(columns) > 10 and '/%s/' % package in columns[10]:
                total += int(columns[3])
    return total


def check_measures(tree, pins, numbers, project):
    package = pins['of']
    untyped_bytes = compiled_bytes('%s/%s/untyped/map' % (PROJECTS, tree), package)
    measured = {
        'typed_percent': numbers['dependencyPercent'] if numbers['dependencyAccesses'] else None,
        'bytes': round(compiled_bytes(project + '/map', package) / untyped_bytes, 3) if untyped_bytes else None,
    }
    is_worse = lambda key, value: value > pins[key] * 1.1 if key == 'bytes' else value < pins[key] - 2
    is_better = lambda key, value: value < pins[key] * 0.9 if key == 'bytes' else value > pins[key] + 2
    worse = [key for key, value in measured.items() if value is None or key in pins and is_worse(key, value)]
    better = [key for key, value in measured.items() if value is not None and key in pins and is_better(key, value)]
    line = ('%s: typedness: %s: %s%% of the property accesses in node_modules are at a fixed offset (pinned %s) · '
            'bytes of its compiled functions, typed / untyped: %s (pinned %s)' % (
                tree, package, measured['typed_percent'], pins.get('typed_percent'), measured['bytes'], pins.get('bytes')))
    if worse:
        fail('%s · worse: %s: the full types are less typed than pinned (which types: bun compile --explain)' % (
            line, ' '.join(worse)))
    else:
        report(True, line + (' · better than pinned: %s: update PINS in run.py' % ' '.join(better) if better else ''))


def check_typedness(tree, project, stdout):
    objects = [json.loads(line) for line in stdout.split('\n') if line.startswith('{')]
    numbers = next((item for item in objects if 'percent' in item), None)
    if not numbers:
        fail('%s: typedness: the typed build printed no --explain=json report, so nothing is compared' % tree)
        return
    pins = pins_of(tree)
    check_open_types(tree, pins, objects)
    check_measures(tree, pins, numbers, project)


def build_tree(tree):
    for build, modules, flags in BUILDS:
        project = create_project(tree, build, modules)
        is_measured = build == 'typed' and tree in PINS
        result = run(
            [BUN, 'build', '--compile', '--aot'] + flags + (['--explain=json'] if is_measured else []) + PRODUCTION_FLAGS
            + [entry_file(tree), '--outfile', project + '/wide'],
            project, dict(ENV, BUN_JSC_aotMapFilePath=project + '/map'))
        output = result.stdout + result.stderr
        if is_measured:
            check_typedness(tree, project, result.stdout)
        write(project + '/build.txt', output)
        if 'TS100009' in output:
            fail('%s %s: a typed package was compiled without its types: %s' % (
                tree, build, re.search(r'.*TS100009.*', output).group(0)[:200]))
        if is_executable(project + '/wide'):
            report(True, '%s %s: built: %d B' % (tree, build, os.path.getsize(project + '/wide')))
        else:
            fail('%s %s: not built: %s' % (tree, build, first_errors(output)))


def build_entry_point(name):
    for build, modules, flags in ENTRY_POINT_BUILDS:
        project = '%s/entries/%s/%s' % (PROJECTS, name, build)
        os.makedirs(project)
        for file in os.listdir(HERE + '/trees/entries'):
            shutil.copy('%s/trees/entries/%s' % (HERE, file), project)
        link_packages(project, modules)
        command = [BUN, 'build', '--compile'] + flags + PRODUCTION_FLAGS + [name + '.ts', '--outfile', project + '/entry']
        result = run(command, project)
        write(project + '/build.txt', result.stdout + result.stderr)
        if not is_executable(project + '/entry'):
            fail('entries %s %s: not built: %s' % (name, build, first_errors(result.stdout + result.stderr)))


def build_all():
    if subprocess.run([sys.executable, HERE + '/check.py', INSTALLED, OUT] + CHECK_FLAGS, env=ENV).returncode:
        sys.exit('run.py: check.py failed, so nothing is built')
    project = PROJECTS + '/lie'
    shutil.copytree(HERE + '/trees/lie', project)
    run([BUN, 'build', '--compile', '--aot'] + AUDIT_FLAGS + ['--target=bun', 'lie.ts', '--outfile', project + '/lie'], project)
    for tree, (packages, _) in TREES.items():
        absent = [package for package in packages if not os.path.isdir('%s/%s' % (INSTALLED, package))]
        if absent:
            print('--   %s: not in this node_modules: %s' % (tree, ' '.join(absent)))
        else:
            build_tree(tree)
    for name, package in ENTRY_POINTS:
        if os.path.isdir('%s/%s' % (INSTALLED, package)):
            build_entry_point(name)


def audit_lines_of(stderr):
    return [line for line in stderr.split('\n') if line.startswith(AUDIT_LINE_PREFIX)]


def check_audit_logs_mismatch():
    project = PROJECTS + '/lie'
    if not is_executable(project + '/lie'):
        fail('the audit build of trees/lie/lie.ts has no executable, so no typed.audit build below proves anything')
        return
    result = run([project + '/lie'], project)
    logged = audit_lines_of(result.stderr)
    if not result.returncode and logged and 'went on' in result.stdout:
        report(True, 'an audit build logs a mismatch: %s' % logged[0][:150])
    else:
        fail('the audit build of trees/lie/lie.ts did not log the mismatch and continue, so no typed.audit build below proves '
             'anything: exit %d: %s' % (result.returncode, result.stderr.strip().split('\n')[-3:]))


def check_entry_point(name):
    base = '%s/entries/%s' % (PROJECTS, name)
    if not os.path.isdir(base):
        return
    results = {}
    for build, _, _ in ENTRY_POINT_BUILDS:
        project = '%s/%s' % (base, build)
        results[build] = run([project + '/entry'], project) if is_executable(project + '/entry') else None
    succeeded = lambda build: results[build] is not None and results[build].returncode == 0
    output = lambda build: results[build].stdout + results[build].stderr if results[build] else '(no executable)'
    is_same = succeeded('typed') and succeeded('untyped') and results['typed'].stdout == results['untyped'].stdout
    report(is_same, 'entries %s: typed %s' % (
        name, 'prints what untyped prints (%s)' % counted(results['typed'].stdout.count('\n'), 'line') if is_same
        else 'differs from untyped'))
    if not is_same:
        for typed, untyped in zip(output('typed').split('\n'), output('untyped').split('\n')):
            if typed != untyped:
                print('          typed:   %s\n          untyped: %s' % (typed[:230], untyped[:230]))
    if succeeded('control') and succeeded('untyped') and results['control'].stdout != results['untyped'].stdout:
        pairs = zip(results['control'].stdout.split('\n'), results['untyped'].stdout.split('\n'))
        note('entries %s: not caused by the full types: on the untouched package, --aot and `bun build --compile` differ in '
             '%s (in a bundle, require() of a module that is also imported has an extra `default`)' % (
                 name, counted(sum(control != untyped for control, untyped in pairs), 'line')))


def split_sections(text):
    headers = []
    sections = {}
    header = None
    for line in text.split('\n'):
        if line.startswith('== '):
            header = line
            while header in sections:
                header += ' (again)'
            headers.append(header)
            sections[header] = []
        elif header is not None:
            sections[header].append(line)
    return headers, sections


def run_with_each_argument_list(command, cwd, argument_lists):
    stdout = stderr = ''
    code = 0
    for arguments in argument_lists:
        result = run(command + arguments, cwd)
        stdout += result.stdout
        stderr += result.stderr
        code += abs(result.returncode)
    return stdout, stderr, code


def print_differences(headers, sections, expected):
    line_at = lambda lines, index: (lines[index:index + 1] or [''])[0]
    for header in headers[:12]:
        compiled = sections.get(header, ['(no such section)'])
        reference = expected.get(header, ['(no such section)'])
        length = max(len(compiled), len(reference))
        index = next((i for i in range(length) if line_at(compiled, i) != line_at(reference, i)), 0)
        print('       %s\n          compiled: %s\n          bun run:  %s' % (
            header, line_at(compiled, index)[:190], line_at(reference, index)[:190]))
        # The first different line can be a consequence of an error that the package caught further down.
        errors = [line.strip() for line in compiled if re.search(r'TypeError|THREW|uncaught', line) and line not in reference]
        if errors:
            print('          an error that `bun run` does not print, in this section: %s' % errors[0][:230])


def remove_known_failures(tree, build, different):
    for (known_tree, prefix), reason in KNOWN_FAILURES.items():
        if known_tree != tree or build == 'untyped':
            continue
        known = [header for header in different if header.startswith(prefix)]
        different = [header for header in different if not header.startswith(prefix)]
        if known:
            note('%s %s: a known failure: %s: %s' % (tree, build, ' | '.join(known), reason))
        else:
            note('%s %s: a known failure passes: `%s..`: take it off KNOWN_FAILURES in run.py' % (tree, build, prefix))
    return different


def unexpected_audit_lines(tree, build, stderr):
    lines = sorted({re.sub(r'; count \d+.*$', '', line) for line in audit_lines_of(stderr)})
    lines = [line for line in lines if not any(re.fullmatch(pattern, line) for pattern in KNOWN_AUDIT_LINES.get(tree, []))]
    if lines and has_variants(tree) and not tree.endswith('.internal'):
        note('%s %s: %s of audit lines. Parsed JSON reaches the package in this program and is read as it is, so they are '
             'not counted. The .internal program must log none' % (tree, build, counted(len(lines), 'kind')))
        return []
    return lines


def check_build(tree, build, headers, known_to_differ, expected):
    project = '%s/%s/%s' % (PROJECTS, tree, build)
    if not is_executable(project + '/wide'):
        fail('%s %s: no executable' % (tree, build))
        return
    stdout, stderr, code = run_with_each_argument_list([project + '/wide'], project, TREES[tree][1])
    write(project + '/answers.txt', stdout)
    write(project + '/answers.err', stderr)
    compiled_headers, sections = split_sections(stdout)
    different = [header for header in headers if sections.get(header) != expected[header]]
    different += [header for header in compiled_headers if header not in expected]
    for header in known_to_differ:
        is_same = sections.get(header) == expected[header]
        note('%s %s: %s: %s' % (tree, build, header[:90], 'the same as `bun run` today' if is_same else 'differs, as expected'))
    different = remove_known_failures(tree, build, different)
    audit_lines = unexpected_audit_lines(tree, build, stderr)
    if build == 'untyped' and tree in KNOWN_UNTYPED_FAILURES and (different or code):
        note('%s untyped: a known failure, not caused by the full types: %s' % (tree, KNOWN_UNTYPED_FAILURES[tree]))
        return
    report(not different and not code and not audit_lines, '%s %s: exit %d · %d of %d sections differ from `bun run`%s' % (
        tree, build, code, len(different), len(headers),
        ' · %s of audit lines' % counted(len(audit_lines), 'kind') if audit_lines else ''))
    print_differences(different, sections, expected)
    for line in audit_lines[:20]:
        print('       ' + line[:200])


def check_tree(tree):
    base = '%s/%s' % (PROJECTS, tree)
    if not os.path.isdir(base):
        return
    command = [BUN, entry_file(tree)]
    first, _, code = run_with_each_argument_list(command, base + '/untyped', TREES[tree][1])
    second, _, _ = run_with_each_argument_list(command, base + '/untyped', TREES[tree][1])
    headers, expected = split_sections(first)
    known_to_differ = [header for header in headers if re.match(r'== 9[89] ', header)]
    headers = [header for header in headers if header not in known_to_differ]
    missing_exports = read(base + '/missing-exports.txt') if os.path.exists(base + '/missing-exports.txt') else ''
    if missing_exports:
        note('%s: this version does not export %s. The scenarios that call them throw, under `bun run` as in every build' % (
            tree, missing_exports))
    report(not code and first == second and ('THREW' not in first or bool(missing_exports)),
           '%s bun run: exit %d · %d sections · %d THREW · a second time: %s' % (
               tree, code, len(headers), first.count('THREW'),
               'the same output' if first == second else 'different output: the tree is not deterministic'))
    for build, _, _ in BUILDS:
        check_build(tree, build, headers, known_to_differ, expected)


def check_answers():
    check_audit_logs_mismatch()
    for name, _ in ENTRY_POINTS:
        check_entry_point(name)
    for tree in TREES:
        check_tree(tree)


if os.environ.get('BUN_SOUND_PINS'):
    load_private_pins(os.environ['BUN_SOUND_PINS'])
if STEP == 'build':
    build_all()
elif STEP == 'answers':
    check_answers()
else:
    sys.exit(__doc__)
print('run.py %s: %s' % (STEP, '%d failed' % failures if failures else 'everything passed'))
sys.exit(1 if failures else 0)
