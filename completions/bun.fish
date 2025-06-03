# This is terribly complicated
# It's because:
# 1. bun run has to have dynamic completions
# 2. there are global options
# 3. bun {install add remove} gets special options
# 4. I don't know how to write fish completions well
# Contributions very welcome!!

function __fish__get_bun_bins
	string split ' ' (bun getcompletes b)
end

function __fish__get_bun_scripts
	set -lx SHELL bash
	set -lx MAX_DESCRIPTION_LEN 40
	string trim (string split '\n' (string split '\t' (bun getcompletes z)))
end

function __fish__get_bun_packages
	if test (commandline -ct) != ""
		set -lx SHELL fish
		string split ' ' (bun getcompletes a (commandline -ct))
	end
end

function __history_completions
	set -l tokens (commandline --current-process --tokenize)
	history --prefix (commandline) | string replace -r \^$tokens[1]\\s\* "" | string replace -r \^$tokens[2]\\s\* "" | string split ' '
end

function __fish__get_bun_bun_js_files
	string split ' ' (bun getcompletes j)
end

set -l bun_install_boolean_flags yarn production optional development no-save dry-run force no-cache silent verbose global ca cafile network-concurrency save-text-lockfile omit lockfile-only trust concurrent-scripts
set -l bun_install_boolean_flags_descriptions "Write a yarn.lock file (yarn v1)" "Don't install devDependencies" "Add dependency to optionalDependencies" "Add dependency to devDependencies" "Don't update package.json or save a lockfile" "Don't install anything" "Always request the latest versions from the registry & reinstall all dependencies" "Ignore manifest cache entirely" "Don't output anything" "Excessively verbose logging" "Use global folder" "Provide a Certificate Authority signing certificate" "The same as --ca, but is a file path to the certificate" "Maximum number of concurrent network requests" "Save a text-based lockfile" "Exclude dev, optional, or peer dependencies from install" "Generate a lockfile without installing dependencies" "Add to trustedDependencies in the project's package.json and install the package(s)" "Maximum number of concurrent jobs for lifecycle scripts (default 5)"

set -l bun_builtin_cmds_without_run dev create help bun upgrade discord install remove add init pm x
set -l bun_builtin_cmds_accepting_flags create help bun upgrade discord run init link unlink pm x

function __bun_complete_bins_scripts --inherit-variable bun_builtin_cmds_without_run -d "Emit bun completions for bins and scripts"
    # Do nothing if we already have a builtin subcommand,
    # or any subcommand other than "run".
    if __fish_seen_subcommand_from $bun_builtin_cmds_without_run
    or not __fish_use_subcommand && not __fish_seen_subcommand_from run
        return
    end
    # Do we already have a bin or script subcommand?
    set -l bins (__fish__get_bun_bins)
    if __fish_seen_subcommand_from $bins
        return
    end
    # Scripts have descriptions appended with a tab separator.
    # Strip off descriptions for the purposes of subcommand testing.
    set -l scripts (__fish__get_bun_scripts)
    if __fish_seen_subcommand_from (string split \t -f 1 -- $scripts)
        return
    end
    # Emit scripts.
    for script in $scripts
        echo $script
    end
    # Emit binaries and JS files (but only if we're doing `bun run`).
    if __fish_seen_subcommand_from run
        for bin in $bins
            echo "$bin"\t"package bin"
        end
        for file in (__fish__get_bun_bun_js_files)
            echo "$file"\t"Bun.js"
        end
    end
end


# Clear existing completions
complete -e -c bun

# Dynamically emit scripts and binaries
complete -c bun -f -a "(__bun_complete_bins_scripts)"

# Complete flags if we have no subcommand or a flag-friendly one.
set -l flag_applies "__fish_use_subcommand; or __fish_seen_subcommand_from $bun_builtin_cmds_accepting_flags"
complete -c bun \
	-n $flag_applies --no-files -s 'u' -l 'origin' -r -d 'Server URL. Rewrites import paths'
complete -c bun \
	-n $flag_applies --no-files  -s 'p' -l 'port' -r -d 'Port number to start server from'
complete -c bun \
	-n $flag_applies --no-files  -s 'd' -l 'define' -r -d 'Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\"'
complete -c bun \
	-n $flag_applies --no-files  -s 'e' -l 'external' -r -d 'Exclude module from transpilation (can use * wildcards). ex: -e react'
complete -c bun \
	-n $flag_applies --no-files -l 'use' -r -d 'Use a framework (ex: next)'
complete -c bun \
	-n $flag_applies --no-files -l 'hot' -r -d 'Enable hot reloading in Bun\'s JavaScript runtime'

# Complete dev and create as first subcommand.
complete -c bun \
	-n "__fish_use_subcommand" -a 'dev' -d 'Start dev server'
complete -c bun \
	-n "__fish_use_subcommand" -a 'create' -f -d 'Create a new project from a template'

# Complete "next" and "react" if we've seen "create".
complete -c bun \
	-n "__fish_seen_subcommand_from create" -a 'next' -d 'new Next.js project'

complete -c bun \
	-n "__fish_seen_subcommand_from create" -a 'react' -d 'new React project'

# Complete "upgrade" as first subcommand.
complete -c bun \
	-n "__fish_use_subcommand" -a 'upgrade' -d 'Upgrade bun to the latest version' -x
# Complete "-h/--help" unconditionally.
complete -c bun \
	-s "h" -l "help" -d 'See all commands and flags' -x

# Complete "-v/--version" if we have no subcommand.
complete -c bun \
	-n "not __fish_use_subcommand" -l "version" -s "v" -d 'Bun\'s version' -x

# Complete additional subcommands.
complete -c bun \
	-n "__fish_use_subcommand" -a 'discord' -d 'Open bun\'s Discord server' -x


complete -c bun \
	-n "__fish_use_subcommand" -a 'bun' -d 'Generate a new bundle'


complete -c bun \
	-n "__fish_seen_subcommand_from bun" -F -d 'Bundle this'

complete -c bun \
	-n "__fish_seen_subcommand_from create; and __fish_seen_subcommand_from react next" -F -d "Create in directory"


complete -c bun \
	-n "__fish_use_subcommand" -a 'init' -F -d 'Start an empty Bun project'

complete -c bun \
	-n "__fish_use_subcommand" -a 'install' -f -d 'Install packages from package.json'

complete -c bun \
	-n "__fish_use_subcommand" -a 'add' -F -d 'Add a package to package.json'

complete -c bun \
	-n "__fish_use_subcommand" -a 'remove' -F -d 'Remove a package from package.json'


for i in (seq (count $bun_install_boolean_flags))
	complete -c bun \
		-n "__fish_seen_subcommand_from install add remove" -l "$bun_install_boolean_flags[$i]" -d "$bun_install_boolean_flags_descriptions[$i]"
end

complete -c bun \
	-n "__fish_seen_subcommand_from install add remove" -l 'cwd' -d 'Change working directory'

complete -c bun \
	-n "__fish_seen_subcommand_from install add remove" -l 'cache-dir' -d 'Choose a cache directory (default: $HOME/.bun/install/cache)'

complete -c bun \
	-n "__fish_seen_subcommand_from add" -d 'Popular' -a '(__fish__get_bun_packages)'

complete -c bun \
	-n "__fish_seen_subcommand_from add" -d 'History' -a '(__history_completions)'

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) cache;" -a 'bin ls cache hash hash-print hash-string audit pack migrate untrusted trust default-trusted whoami' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from cache; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts);" -a 'rm' -f

# Add built-in subcommands with descriptions.
complete -c bun -n "__fish_use_subcommand" -a "create" -f -d "Create a new project from a template"
complete -c bun -n "__fish_use_subcommand" -a "build bun" --require-parameter -F -d "Transpile and bundle one or more files"
complete -c bun -n "__fish_use_subcommand" -a "upgrade" -d "Upgrade Bun"
complete -c bun -n "__fish_use_subcommand" -a "run" -d "Run a script or package binary"
complete -c bun -n "__fish_use_subcommand" -a "install" -d "Install dependencies from package.json" -f
complete -c bun -n "__fish_use_subcommand" -a "remove" -d "Remove a dependency from package.json" -f
complete -c bun -n "__fish_use_subcommand" -a "add" -d "Add a dependency to package.json" -f
complete -c bun -n "__fish_use_subcommand" -a "init" -d "Initialize a Bun project in this directory" -f
complete -c bun -n "__fish_use_subcommand" -a "link" -d "Register or link a local npm package" -f
complete -c bun -n "__fish_use_subcommand" -a "unlink" -d "Unregister a local npm package" -f
complete -c bun -n "__fish_use_subcommand" -a "pm" -d "Additional package management utilities" -f
complete -c bun -n "__fish_use_subcommand" -a "x" -d "Execute a package binary, installing if needed" -f
complete -c bun -n "__fish_use_subcommand" -a "outdated" -d "Display the latest versions of outdated dependencies" -f
complete -c bun -n "__fish_use_subcommand" -a "publish" -d "Publish your package from local to npm" -f

# Add explicit completions for missing test flags
complete -c bun -n "__fish_seen_subcommand_from test" -l 'timeout' -d 'Set the per-test timeout in milliseconds, default is 5000.'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'update-snapshots' -d 'Update snapshot files'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'rerun-each' -d 'Re-run each test file <NUMBER> times, helps catch certain bugs'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'only' -d 'Only run tests that are marked with test.only()'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'todo' -d 'Include tests that are marked with test.todo()'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'coverage' -d 'Generate a coverage profile'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'coverage-reporter' -d 'Report coverage in text and/or lcov. Defaults to text.'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'coverage-dir' -d 'Directory for coverage files. Defaults to coverage.'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'bail' -d 'Exit the test suite after <NUMBER> failures. If you do not specify a number, it defaults to 1.'
complete -c bun -n "__fish_seen_subcommand_from test" -l 'test-name-pattern' -d 'Run only tests with a name that matches the given regex.'

# Add completions for bun build flags
complete -c bun -n "__fish_seen_subcommand_from build" -l 'production' -d 'Set NODE_ENV=production and enable minification'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'compile' -d 'Generate a standalone Bun executable containing your bundled code. Implies --production'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'bytecode' -d 'Use a bytecode cache'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'watch' -d 'Automatically restart the process on file change'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'no-clear-screen' -d 'Disable clearing the terminal screen on reload when --watch is enabled'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'target' -d 'The intended execution environment for the bundle. "browser", "bun" or "node"'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'outdir' -d 'Default to "dist" if multiple files'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'outfile' -d 'Write to a file'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'sourcemap' -d 'Build with sourcemaps - linked, inline, external, or none'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'minify' -d 'Enable all minification flags'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'minify-syntax' -d 'Minify syntax and inline data'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'minify-whitespace' -d 'Minify whitespace'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'minify-identifiers' -d 'Minify identifiers'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'format' -d 'Specifies the module format to build to. "esm", "cjs" and "iife" are supported. Defaults to "esm".'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'banner' -d 'Add a banner to the bundled output'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'footer' -d 'Add a footer to the bundled output'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'root' -d 'Root directory used for multiple entry points'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'splitting' -d 'Enable code splitting'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'public-path' -d 'A prefix to be appended to any import paths in bundled code'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'entry-naming' -d 'Customize entry point filenames'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'chunk-naming' -d 'Customize chunk filenames'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'asset-naming' -d 'Customize asset filenames'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'react-fast-refresh' -d 'Enable React Fast Refresh transform'
complete -c bun -n "__fish_seen_subcommand_from build" -l 'no-bundle' -d 'Transpile file only, do not bundle'
