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

set -l bun_install_boolean_flags yarn production no-save dry-run force no-cache silent verbose global
set -l bun_install_boolean_flags_descriptions "Write a yarn.lock file (yarn v1)" "Don't install devDependencies" "Don't update package.json or save a lockfile" "Don't install anything" "Always request the latest versions from the registry & reinstall all dependencies" "Ignore manifest cache entirely" "Don't output anything" "Excessively verbose logging" "Use global folder"

set -l bun_builtin_cmds_without_run dev create help bun upgrade discord install remove add update audit dedupe prune publish init pm x repl check lint fmt
# The package manager commands and `bun x` reject a flag they do not have.
set -l bun_builtin_cmds_accepting_flags create help bun upgrade discord run init

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
		-n "__fish_seen_subcommand_from install add remove dedupe" -l "$bun_install_boolean_flags[$i]" -d "$bun_install_boolean_flags_descriptions[$i]"
end

complete -c bun \
	-n "__fish_seen_subcommand_from install add" -l 'optional' -d 'Add dependency to optionalDependencies'

complete -c bun \
	-n "__fish_seen_subcommand_from install add" -l 'development' -d 'Add dependency to devDependencies'

complete -c bun \
	-n "__fish_seen_subcommand_from install add remove update dedupe" -l 'cwd' -d 'Change working directory'

complete -c bun \
	-n "__fish_seen_subcommand_from install add remove update dedupe" -l 'cache-dir' -d 'Choose a cache directory (default: $HOME/.bun/install/cache)'

complete -c bun \
	-n "__fish_seen_subcommand_from install add remove" -s 'F' -l 'filter' -r -d 'Apply to the matching workspaces instead of the current package'

complete -c bun \
	-n "__fish_seen_subcommand_from install add" -l 'catalog' -d 'Add the resolved version to the root package.json catalog and depend on it as "catalog:" (--catalog=NAME for a named catalog)'

complete -c bun \
	-n "__fish_seen_subcommand_from dedupe" -l 'check' -d 'Exit with code 1 if the lockfile has duplicate versions that can be removed, without changing anything'

complete -c bun \
	-n "__fish_seen_subcommand_from add" -d 'Popular' -a '(__fish__get_bun_packages)'

complete -c bun \
	-n "__fish_seen_subcommand_from add" -d 'History' -a '(__history_completions)'

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) cache;" -a 'bin ls licenses cache hash hash-print hash-string' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from cache; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts);" -a 'rm prune pack unpack' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from licenses" -l 'json' -d 'Output as JSON' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from licenses" -l 'prod' -d 'Omit devDependencies' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from licenses" -l 'production' -d 'Omit devDependencies' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from licenses" -l 'dev' -s 'D' -d 'List only what devDependencies pull in' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from licenses" -l 'long' -d 'Also print author, description and homepage' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from licenses" -l 'filter' -s 'F' -d 'List only the matching workspaces' -r

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
complete -c bun -n "__fish_use_subcommand" -a "audit" -d "Check installed packages for vulnerabilities" -f
complete -c bun -n "__fish_use_subcommand" -a "check" -d "Type check a TypeScript project" -f
complete -c bun -n "__fish_seen_subcommand_from check" -s "p" -l "project" -r -F -d "Path to a tsconfig.json or its directory"
complete -c bun -n "__fish_seen_subcommand_from check" -l "pretty" -d "Show source code around each error"
complete -c bun -n "__fish_seen_subcommand_from check" -s "b" -l "build" -d "Check the projects in references too, like tsc -b"
complete -c bun -n "__fish_seen_subcommand_from check" -l "no-pretty" -d "One line per error"
complete -c bun -n "__fish_seen_subcommand_from check" -l "all" -d "Show every error"
complete -c bun -n "__fish_seen_subcommand_from check" -l "threads" -r -d "Number of threads"
complete -c bun -n "__fish_seen_subcommand_from check" -l "timing" -d "Print load and check times"
complete -c bun -n "__fish_seen_subcommand_from check" -l "cwd" -r -d "Set the working directory"
complete -c bun -n "__fish_seen_subcommand_from check" -l "no-script" -d "Run the type checker even if the project has a check script"
complete -c bun -n "__fish_use_subcommand" -a "lint" -d "Lint JavaScript and TypeScript" -f
complete -c bun -n "__fish_seen_subcommand_from lint" -s "c" -l "config" -r -F -d "Use this config file instead of looking for one"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-config-lookup" -d "Do not look for a config file"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "rule" -r -d "Set a rule, or turn off a plugin: --rule 'eqeqeq: [error, smart]', --rule 'unicorn/*: off'"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "rules" -d "List the built-in rules"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "explain" -r -d "Print the documentation of a rule"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "init" -d "Add a [lint] section to bunfig.toml"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "global" -r -d "Define global variables: --global a,b:true"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-inline-config" -d "Ignore eslint-disable and other config comments"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "report-unused-disable-directives" -d "Report eslint-disable comments that disable nothing"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "print-config" -r -F -d "Print the config for a file and exit"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "doctor" -d "Show which rules run natively and which packages you can remove"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "allow-unsupported" -d "Warn instead of failing when the config has a rule or file that is not supported"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "staged" -d "Only lint files that are staged in git"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "changed" -d "Only lint files that differ from a branch or commit (default: the default branch)"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "ignore-pattern" -r -d "Skip files that match this pattern"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "ignore-path" -r -F -d "Read ignore patterns from this file instead of .eslintignore"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-ignore" -d "Lint ignored files too"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "ext" -r -d "Also lint files with these extensions"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "stdin" -d "Lint code from standard input"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "stdin-filename" -r -F -d "The file name to use for code from standard input"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "list-files" -d "Print the files that would be linted and exit"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-error-on-unmatched-pattern" -d "Do not fail when an argument matches no file"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "cwd" -r -d "Set the working directory"
complete -c bun -n "__fish_seen_subcommand_from lint" -s "f" -l "format" -r -d "pretty (default), stylish, json, json-with-metadata, unix, github, agent, checkstyle, junit, gitlab, sarif"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "all" -d "Show every problem (pretty and agent group identical problems above 50)"
complete -c bun -n "__fish_seen_subcommand_from lint" -s "o" -l "output-file" -r -F -d "Write the report to a file"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "quiet" -d "Report errors only"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "max-warnings" -r -d "Exit with 1 if there are more warnings than this"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "color" -d "Always use colors"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-color" -d "Never use colors"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "timing" -d "Print how long each phase took"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "fix" -d "Fix problems and write the files"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "fix-dry-run" -d "Fix without writing. The json format has the fixed code"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "fix-type" -r -d "Only apply fixes from rules of these types: directive, problem, suggestion, layout"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "fix-suggestions" -d "Apply suggestions"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "fix-dangerously" -d "Apply every fix and suggestion, even those that can change behavior"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "type-aware" -d "Also run the rules that need types"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-type-aware" -d "Skip the rules that need types"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "tsconfig" -r -F -d "Use this tsconfig.json instead of the nearest one"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "type-check" -d "With --type-aware, report type errors too"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "infer-globals" -d "Also treat what the project's types declare as globals"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-infer-globals" -d "Do not take globals from the project's types"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "threads" -r -d "Number of threads (default: one per CPU core)"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-script" -d "Run the linter even if the project has a lint script"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "help-all" -d "The same as --help --all"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "flavor" -r -d "Use the eslint or the oxlint config in a project that has both"
complete -c bun -n "__fish_seen_subcommand_from lint" -s "p" -l "project" -r -F -d "The same as --tsconfig"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "parser-options" -r -d "Set parser options: --parser-options projectService:true"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "parser" -r -d "Parse files with this package"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "plugin" -r -d "Load these plugins"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "native-plugin-rules" -r -d "Of the ESLint plugins a config loads, run only these natively: import,react-hooks (default: all)"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-native-plugin-rules" -d "Run plugin rules from the installed packages, in JavaScript"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "report-unused-disable-directives-severity" -r -d "Report unused eslint-disable comments as off, warn or error"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "report-unused-inline-configs" -r -d "Report config comments that change nothing"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-warn-ignored" -d "Do not warn when an argument names an ignored file"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "suppress-all" -d "Record the current errors in eslint-suppressions.json and stop reporting them"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "suppress-rule" -r -d "The same, for the errors of one rule"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "suppressions-location" -r -F -d "Use this file instead of eslint-suppressions.json"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "prune-suppressions" -d "Remove recorded errors that no longer occur from that file"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "pass-on-unpruned-suppressions" -d "Do not fail when that file has errors that no longer occur"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "pass-on-no-patterns" -d "Exit with 0 when there are no arguments, instead of linting ."
complete -c bun -n "__fish_seen_subcommand_from lint" -l "exit-on-fatal-error" -d "Exit with 2 if a file cannot be parsed"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "concurrency" -r -d "The same as --threads"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "env-info" -d "Print the versions of Bun, ESLint and TypeScript"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "no-eslintrc" -d "ESLint 8: do not look for .eslintrc files"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "env" -r -d "ESLint 8: turn on these environments"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "rulesdir" -r -F -d "ESLint 8: load rules from these directories"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "resolve-plugins-relative-to" -r -F -d "ESLint 8: look for plugins from this directory"
complete -c bun -n "__fish_seen_subcommand_from lint" -s "A" -l "allow" -r -d "Turn off a rule or a category"
complete -c bun -n "__fish_seen_subcommand_from lint" -s "W" -l "warn" -r -d "Make a rule or a category a warning"
complete -c bun -n "__fish_seen_subcommand_from lint" -s "D" -l "deny" -r -d "Make a rule or a category an error"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "deny-warnings" -d "Exit with 1 if there are warnings"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "silent" -d "Print no problems"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "disable-nested-config" -d "Use the config file in the working directory for every file"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "import-plugin" -d "Turn on the import plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "react-plugin" -d "Turn on the react plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "jsdoc-plugin" -d "Turn on the jsdoc plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "jest-plugin" -d "Turn on the jest plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "vitest-plugin" -d "Turn on the vitest plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "jsx-a11y-plugin" -d "Turn on the jsx-a11y plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "nextjs-plugin" -d "Turn on the nextjs plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "react-perf-plugin" -d "Turn on the react-perf plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "promise-plugin" -d "Turn on the promise plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "node-plugin" -d "Turn on the node plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "vue-plugin" -d "Turn on the vue plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "disable-unicorn-plugin" -d "Turn off the unicorn plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "disable-oxc-plugin" -d "Turn off the oxc plugin"
complete -c bun -n "__fish_seen_subcommand_from lint" -l "disable-typescript-plugin" -d "Turn off the typescript plugin"
complete -c bun -n "__fish_use_subcommand" -a "fmt" -d "Format code the way Prettier does" -f
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "config" -r -F -d "Use this config file instead of looking for one"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-config" -d "Do not look for a config file"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-editorconfig" -d "Do not read .editorconfig"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "init" -d "Add a [fmt] section to bunfig.toml"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "doctor" -d "Show which files are formatted natively and which packages you can remove"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "print-width" -r -d "The line length to wrap at (default: 80)"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "tab-width" -r -d "Spaces per indentation level (default: 2)"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "use-tabs" -d "Indent with tabs"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-semi" -d "Only print semicolons where they are needed"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "single-quote" -d "Use single quotes"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "jsx-single-quote" -d "Use single quotes in JSX"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "quote-props" -r -d "as-needed (default), consistent, or preserve"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "trailing-comma" -r -d "all (default), es5, or none"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-bracket-spacing" -d "No spaces inside the braces of an object literal"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "bracket-same-line" -d "Put the closing bracket of a multi-line element at the end of the last line"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "arrow-parens" -r -d "always (default) or avoid"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "object-wrap" -r -d "preserve (default) or collapse"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "single-attribute-per-line" -d "One attribute per line in HTML, Vue, and JSX"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "html-whitespace-sensitivity" -r -d "css (default), strict, or ignore"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "vue-indent-script-and-style" -d "Indent the code in the script and style tags of Vue files"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "prose-wrap" -r -d "preserve (default), always, or never"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "embedded-language-formatting" -r -d "auto (default) or off"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "end-of-line" -r -d "lf (default), crlf, cr, or auto"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-insert-final-newline" -d "Do not end files with a newline"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "sort-imports" -d "Sort and group imports"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "sort-tailwindcss" -d "Sort Tailwind CSS classes"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "sort-package-json" -d "Sort the keys of package.json"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "jsdoc" -d "Format JSDoc comments"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "svelte" -d "Format Svelte components (default without a Prettier or oxfmt config)"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-svelte" -d "Do not format Svelte components"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "staged" -d "Only format files that are staged in git, and stage them again"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "changed" -d "Only format files that differ from a branch or commit (default: the default branch)"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "stdin-filepath" -r -F -d "Format standard input as this file and print the result"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "ignore-path" -r -F -d "Read ignore patterns from these files (default: .gitignore, .prettierignore, .git/info/exclude)"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "ignore-pattern" -r -d "Skip files that match this pattern"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "with-node-modules" -d "Format files in node_modules too"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-error-on-unmatched-pattern" -d "Do not fail when an argument matches no file"
complete -c bun -n "__fish_seen_subcommand_from fmt" -s "u" -l "ignore-unknown" -d "Ignore files in an unknown language"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "allow-unsupported" -d "Warn instead of failing when the language of a file is not supported"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "list-files" -d "Print the files that would be formatted and exit"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "cwd" -r -d "Set the working directory"
complete -c bun -n "__fish_seen_subcommand_from fmt" -s "c" -l "check" -d "Do not write. Exit with 1 if a file needs formatting"
complete -c bun -n "__fish_seen_subcommand_from fmt" -s "l" -l "list-different" -d "Do not write. Print the files that need formatting and exit with 1 if there are any"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "log-level" -r -d "silent, error, warn, log (default), or debug"
complete -c bun -n "__fish_seen_subcommand_from fmt" -s "f" -l "format" -r -d "With --doctor, print the report as json"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "color" -d "Always use colors"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-color" -d "Never use colors"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "timing" -d "Print how long each phase took"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "threads" -r -d "Number of threads (default: one per CPU core)"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "debug-check" -d "Do not write. Fail if formatting a file would change what it means"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "no-script" -d "Run the formatter even if the project has a fmt script"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "all" -d "With --help, print every flag"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "help-all" -d "The same as --help --all"
complete -c bun -n "__fish_seen_subcommand_from fmt" -s "w" -l "write" -d "Write the files. This is the default"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "config-precedence" -r -d "cli-override (default), file-override, or prefer-file"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "find-config-path" -r -F -d "Print the path of the config for a file and exit"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "parser" -r -d "Read every file with this parser"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "plugin" -r -d "Load these plugins"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "require-pragma" -d "Only format files that start with a @format or @prettier comment"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "check-ignore-pragma" -d "Skip files that start with a @noformat or @noprettier comment"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "insert-pragma" -d "Put a @format comment at the top of formatted files"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "range-start" -r -d "Only format the statements from this offset on"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "range-end" -r -d "Only format the statements up to this offset"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "cursor-offset" -r -d "With --stdin-filepath, print on stderr where this offset ends up"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "experimental-ternaries" -d "Put the question mark of a ternary after the condition"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "experimental-operator-position" -r -d "end (default) or start"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "jsx-bracket-same-line" -d "The old name of --bracket-same-line"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "flavor" -r -d "Without a config file, format like prettier or like oxfmt"
complete -c bun -n "__fish_seen_subcommand_from fmt" -l "disable-nested-config" -d "Use the config file in the working directory for every file"
complete -c bun -n "__fish_use_subcommand" -a "dedupe" -d "Remove duplicate versions from the lockfile" -f
complete -c bun -n "__fish_use_subcommand" -a "prune" -d "Remove packages that are not in the lockfile from node_modules" -f
complete -c bun -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from fix" -a "fix" -d "Upgrade vulnerable packages to the lowest safe version" -f
complete -c bun -n "__fish_seen_subcommand_from audit" -l "json" -d "Output in JSON format" -f
complete -c bun -n "__fish_seen_subcommand_from audit" -l "audit-level" -r -a "low moderate high critical" -d "Only print advisories at or above this severity" -f
complete -c bun -n "__fish_seen_subcommand_from audit" -l "ignore" -r -d "Ignore advisories by GHSA or numeric advisory ID" -f
complete -c bun -n "__fish_seen_subcommand_from audit" -l "prod" -d "Omit devDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from audit prune" -l "omit" -r -a "dev optional peer" -d "Omit the given dependency type" -f
complete -c bun -n "__fish_seen_subcommand_from audit prune" -l "dry-run" -d "Print what would change without changing anything" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -l "check" -d "Exit with code 1 if node_modules has packages that can be removed, without deleting anything" -f
complete -c bun -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from fix" -s "L" -l "latest" -d "Also apply fixes that fall outside the ranges declared in package.json or catalogs" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -s "p" -l "production" -d "Also remove packages that are only needed by devDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -s "P" -l "prod" -d "Also remove packages that are only needed by devDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -l "os" -r -d "Prune for a different operating system than the current one" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -l "cpu" -r -d "Prune for a different CPU architecture than the current one" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -l "libc" -r -a "glibc musl" -d "Prune for a different libc than the current one" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -l "linker" -r -a "isolated hoisted" -d "Linker to assume when node_modules mixes isolated and hoisted installs" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -s "F" -l "filter" -r -d "Prune only the matching workspaces" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -l "silent" -d "Don't log anything" -f
complete -c bun -n "__fish_seen_subcommand_from audit prune" -l "cwd" -r -d "Set a specific cwd"
complete -c bun -n "__fish_use_subcommand" -a "update" -d "Update dependencies to their latest versions" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "p" -l "production" -d "Only update dependencies and optionalDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "P" -l "prod" -d "Only update dependencies and optionalDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "d" -l "dev" -d "Only update devDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "D" -l "development" -d "Only update devDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from update" -l "no-optional" -d "Don't update optionalDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "E" -l "exact" -d "Write exact versions to package.json instead of ^ or ~ ranges" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "L" -l "latest" -d "Update packages to their latest versions, ignoring the ranges in package.json" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "i" -l "interactive" -d "Show an interactive list of outdated packages to select for update" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "r" -l "recursive" -d "Update packages in all workspaces" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "F" -l "filter" -r -d "Update packages for the matching workspaces" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "g" -l "global" -d "Update the packages installed globally" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "y" -l "yarn" -d "Write a yarn.lock file (yarn v1)" -f
complete -c bun -n "__fish_seen_subcommand_from update" -l "no-save" -d "Don't update package.json or save a lockfile" -f
complete -c bun -n "__fish_seen_subcommand_from update" -l "dry-run" -d "Perform a dry run without making changes" -f
complete -c bun -n "__fish_seen_subcommand_from update" -s "f" -l "force" -d "Always request the latest versions from the registry & reinstall all dependencies" -f
complete -c bun -n "__fish_seen_subcommand_from update" -l "no-cache" -d "Ignore manifest cache entirely" -f
complete -c bun -n "__fish_seen_subcommand_from update" -l "silent" -d "Don't log anything" -f
complete -c bun -n "__fish_seen_subcommand_from update" -l "verbose" -d "Excessively verbose logging" -f
complete -c bun -n "__fish_use_subcommand" -a "publish" -d "Publish your package from local to npm" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -s "r" -l "recursive" -d "Publish every workspace package whose version is not on the registry" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -s "F" -l "filter" -r -d "Publish each matching workspace package" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "access" -r -a "public restricted" -d "Set access level for scoped packages" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "tag" -r -d "Tag the release. Default is \"latest\"" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "otp" -r -d "Provide a one-time password for authentication" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "auth-type" -r -a "web legacy" -d "Specify the type of one-time password authentication" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "gzip-level" -r -d "Specify a custom compression level for gzip. Default is 9." -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "tolerate-republish" -d "Don't exit with code 1 when republishing over an existing version number" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "dry-run" -d "Perform a dry run without making changes" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "ignore-scripts" -d "Skip lifecycle scripts" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "registry" -r -d "Use a specific registry by default" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "silent" -d "Don't log anything" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "verbose" -d "Excessively verbose logging" -f
complete -c bun -n "__fish_seen_subcommand_from publish" -l "cwd" -r -d "Set a specific cwd"
complete -c bun -n "__fish_seen_subcommand_from x" -l "bun" -d "Force the command to run with Bun instead of Node.js" -f
complete -c bun -n "__fish_seen_subcommand_from x" -s "p" -l "package" -r -d "Package to install when the binary name differs from the package name" -f
complete -c bun -n "__fish_seen_subcommand_from x" -l "no-install" -d "Skip installation if the package is not already installed" -f
complete -c bun -n "__fish_seen_subcommand_from x" -l "cwd" -r -d "Set the working directory"
complete -c bun -n "__fish_seen_subcommand_from x" -l "env-file" -r -d "Load environment variables from the specified file(s)"
complete -c bun -n "__fish_seen_subcommand_from x" -l "minimum-release-age" -r -d "Only install packages published at least N seconds ago" -f
complete -c bun -n "__fish_seen_subcommand_from x" -l "trust" -d "Run the lifecycle scripts of the package and of ALL of its dependencies" -f
complete -c bun -n "__fish_seen_subcommand_from x" -l "verbose" -d "Enable verbose output during installation" -f
complete -c bun -n "__fish_seen_subcommand_from x" -l "silent" -d "Suppress output during installation" -f
complete -c bun -n "__fish_use_subcommand" -a "repl" -d "Start a REPL session with Bun" -f
complete -c bun -n "__fish_seen_subcommand_from repl" -s "e" -l "eval" -r -d "Evaluate argument as a script, then exit" -f
complete -c bun -n "__fish_seen_subcommand_from repl" -s "p" -l "print" -r -d "Evaluate argument as a script, print the result, then exit" -f
complete -c bun -n "__fish_seen_subcommand_from repl" -s "r" -l "preload" -r -d "Import a module before other modules are loaded"
complete -c bun -n "__fish_seen_subcommand_from repl" -l "smol" -d "Use less memory, but run garbage collection more often" -f
complete -c bun -n "__fish_seen_subcommand_from repl" -s "c" -l "config" -r -d "Specify path to Bun config file"
complete -c bun -n "__fish_seen_subcommand_from repl" -l "cwd" -r -d "Absolute path to resolve files & entry points from"
complete -c bun -n "__fish_seen_subcommand_from repl" -l "env-file" -r -d "Load environment variables from the specified file(s)"
complete -c bun -n "__fish_seen_subcommand_from repl" -l "no-env-file" -d "Disable automatic loading of .env files" -f
