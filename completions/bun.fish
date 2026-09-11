# Bun completions for fish shell
#
# Known limitations:
# 1. No flag completions for custom scripts
# 2. Doesn't read bunfig.toml
# 3. Bun install filter completions don't work yet
# 4. I don't know how to write fish completions well
# Contributions very welcome!!

function __fish__bun_extract_cwd
    set -l tokens (commandline -cop)
    for i in (seq 1 (count $tokens))
        set -l val ""
        if test "$tokens[$i]" = "--cwd"
            set -l next_idx (math $i + 1)
            if test $next_idx -le (count $tokens)
                set val "$tokens[$next_idx]"
            end
        else if string match -q -- "--cwd=*" "$tokens[$i]"
            set val (string replace -- "--cwd=" "" "$tokens[$i]")
        end

        if test -n "$val"
            set val (string replace -r '^["\'](.*)["\']$' '$1' -- "$val")
            set val (string replace -r '^~' "$HOME" -- "$val")
            echo "$val"
            return
        end
    end
    echo "."
end

function __fish__get_bun_bins
    set -l target_cwd (__fish__bun_extract_cwd)
    if test -d "$target_cwd"
        builtin cd "$target_cwd"
        string split " " (bun getcompletes b 2>/dev/null)
    end
end

function __fish__get_bun_scripts
    set -l target_cwd (__fish__bun_extract_cwd)
    if test -d "$target_cwd"
        builtin cd "$target_cwd"
        set -lx SHELL bash
        set -lx MAX_DESCRIPTION_LEN 40
        string trim (string split "\n" (string split '\t' (bun getcompletes z 2>/dev/null)))
    end
end

function __fish__get_bun_packages
    # TODO: this needs to be implemented in `bun getcompletes`
    if not test -f package.json
        return
    end

    if not command -qs jq
        return
    end

    set -l dependencies (jq -r '.dependencies | keys[]' package.json 2>/dev/null)
    set -l dev_dependencies (jq -r '.devDependencies | keys[]' package.json 2>/dev/null)
    string split " " "$dependencies $dev_dependencies"
end

function __fish__bun_needs_command
    # Check if a subcommand has already been specified
    set -l cmd (commandline -opc)
    if test (count $cmd) -eq 1
        return 0
    end
    return 1
end

function __fish__bun_using_command
    set -l cmd (commandline -opc)
    if test (count $cmd) -gt 1
        if test $argv[1] = $cmd[2]
            return 0
        end
    end
    return 1
end

# Subcommands
complete -f -c bun -n '__fish__bun_needs_command' -a 'add' -d 'Add a dependency to package.json'
complete -f -c bun -n '__fish__bun_needs_command' -a 'build' -d 'Bundle assets for the browser or other platforms'
complete -f -c bun -n '__fish__bun_needs_command' -a 'create' -d 'Create a new project from a template'
complete -f -c bun -n '__fish__bun_needs_command' -a 'init' -d 'Scaffold an empty project'
complete -f -c bun -n '__fish__bun_needs_command' -a 'install' -d 'Install dependencies for a package.json'
complete -f -c bun -n '__fish__bun_needs_command' -a 'link' -d 'Register or link a local npm package'
complete -f -c bun -n '__fish__bun_needs_command' -a 'pm' -d 'More package management utilities'
complete -f -c bun -n '__fish__bun_needs_command' -a 'remove' -d 'Remove a dependency from package.json'
complete -f -c bun -n '__fish__bun_needs_command' -a 'unlink' -d 'Unregister a local npm package'
complete -f -c bun -n '__fish__bun_needs_command' -a 'update' -d 'Update outdated dependencies'
complete -f -c bun -n '__fish__bun_needs_command' -a 'run' -d 'Execute a file or package.json script'
complete -f -c bun -n '__fish__bun_needs_command' -a 'test' -d 'Run unit tests'
complete -f -c bun -n '__fish__bun_needs_command' -a 'x' -d 'Execute a package binary (CLI), installing if needed'
complete -f -c bun -n '__fish__bun_needs_command' -a 'repl' -d 'Start a REPL session'
complete -f -c bun -n '__fish__bun_needs_command' -a 'upgrade' -d 'Upgrade Bun to the latest version'

# Options
complete -c bun -s h -l help -d 'Print help message'
complete -c bun -s v -l version -d 'Print version and exit'

# bun run
complete -f -c bun -n '__fish__bun_using_command run' -a '(__fish__get_bun_scripts)' -d 'package.json scripts'
complete -f -c bun -n '__fish__bun_using_command run' -a '(__fish__get_bun_bins)' -d 'node_modules/.bin'

# bun pm
complete -f -c bun -n '__fish__bun_using_command pm' -a 'bin' -d 'Print the path to the bin directory'
complete -f -c bun -n '__fish__bun_using_command pm' -a 'ls' -d 'List installed dependencies'
complete -f -c bun -n '__fish__bun_using_command pm' -a 'cache' -d 'Print the path to the cache directory'
complete -f -c bun -n '__fish__bun_using_command pm' -a 'hash' -d 'Generate and print the lockfile hash'

# bun remove
complete -f -c bun -n '__fish__bun_using_command remove' -a '(__fish__get_bun_packages)' -d 'installed packages'
