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

set -l bun_install_boolean_flags yarn production optional development no-save dry-run force no-cache silent verbose global
set -l bun_install_boolean_flags_descriptions "Write a yarn.lock file (yarn v1)" "Don't install devDependencies" "Add dependency to optionalDependencies" "Add dependency to devDependencies" "Don't update package.json or save a lockfile" "Don't install anything" "Always request the latest versions from the registry & reinstall all dependencies" "Ignore manifest cache entirely" "Don't output anything" "Excessively verbose logging" "Use global folder"

set -l bun_builtin_cmds_without_run dev create help bun upgrade discord install remove add update audit dedupe prune init pm x repl
set -l bun_builtin_cmds_accepting_flags create help bun upgrade discord run init link unlink pm x update

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
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from cache; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts);" -a 'rm' -f

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
complete -c bun -n "__fish_use_subcommand" -a "dedupe" -d "Remove duplicate versions from the lockfile" -f
complete -c bun -n "__fish_use_subcommand" -a "prune" -d "Remove packages that are not in the lockfile from node_modules" -f
complete -c bun -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from fix" -a "fix" -d "Upgrade vulnerable packages to the lowest safe version" -f
complete -c bun -n "__fish_seen_subcommand_from audit" -l "json" -d "Output in JSON format" -f
complete -c bun -n "__fish_seen_subcommand_from audit" -l "audit-level" -r -a "low moderate high critical" -d "Only print advisories at or above this severity" -f
complete -c bun -n "__fish_seen_subcommand_from audit" -l "ignore" -r -d "Ignore advisories by GHSA or numeric advisory ID" -f
complete -c bun -n "__fish_seen_subcommand_from audit" -l "prod" -d "Omit devDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from audit prune" -l "omit" -r -a "dev optional peer" -d "Omit the given dependency type" -f
complete -c bun -n "__fish_seen_subcommand_from audit prune" -l "dry-run" -d "Print what would change without changing anything" -f
complete -c bun -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from fix" -s "L" -l "latest" -d "Also apply fixes that fall outside the ranges declared in package.json or catalogs" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -s "p" -l "production" -d "Also remove packages that are only needed by devDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -s "P" -l "prod" -d "Also remove packages that are only needed by devDependencies" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -l "os" -r -d "Prune for a different operating system than the current one" -f
complete -c bun -n "__fish_seen_subcommand_from prune" -l "cpu" -r -d "Prune for a different CPU architecture than the current one" -f
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
complete -c bun -n "__fish_use_subcommand" -a "repl" -d "Start a REPL session with Bun" -f
complete -c bun -n "__fish_seen_subcommand_from repl" -s "e" -l "eval" -r -d "Evaluate argument as a script, then exit" -f
complete -c bun -n "__fish_seen_subcommand_from repl" -s "p" -l "print" -r -d "Evaluate argument as a script, print the result, then exit" -f
complete -c bun -n "__fish_seen_subcommand_from repl" -s "r" -l "preload" -r -d "Import a module before other modules are loaded"
complete -c bun -n "__fish_seen_subcommand_from repl" -l "smol" -d "Use less memory, but run garbage collection more often" -f
complete -c bun -n "__fish_seen_subcommand_from repl" -s "c" -l "config" -r -d "Specify path to Bun config file"
complete -c bun -n "__fish_seen_subcommand_from repl" -l "cwd" -r -d "Absolute path to resolve files & entry points from"
complete -c bun -n "__fish_seen_subcommand_from repl" -l "env-file" -r -d "Load environment variables from the specified file(s)"
complete -c bun -n "__fish_seen_subcommand_from repl" -l "no-env-file" -d "Disable automatic loading of .env files" -f
