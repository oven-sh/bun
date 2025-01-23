#compdef bun

_bun_add_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '*: :->package' \
        '--config[Load config(bunfig.toml)]: :->config' \
        '-c[Load config(bunfig.toml)]: :->config' \
        '--yarn[Write a yarn.lock file (yarn v1)]' \
        '-y[Write a yarn.lock file (yarn v1)]' \
        '--production[Don'"'"'t install devDependencies]' \
        '-p[Don'"'"'t install devDependencies]' \
        '--no-save[Don'"'"'t save a lockfile]' \
        '--save[Save to package.json]' \
        '--dry-run[Don'"'"'t install anything]' \
        '--frozen-lockfile[Disallow changes to lockfile]' \
        '--force[Always request the latest versions from the registry & reinstall all dependencies]' \
        '-f[Always request the latest versions from the registry & reinstall all dependencies]' \
        '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
        '--no-cache[Ignore manifest cache entirely]' \
        '--silent[Don'"'"'t log anything]' \
        '--verbose[Excessively verbose logging]' \
        '--no-progress[Disable the progress bar]' \
        '--no-summary[Don'"'"'t print a summary]' \
        '--no-verify[Skip verifying integrity of newly downloaded packages]' \
        '--ignore-scripts[Skip lifecycle scripts in the package.json (dependency scripts are never run)]' \
        '--global[Add a package globally]' \
        '-g[Add a package globally]' \
        '--cwd[Set a specific cwd]:cwd' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:("copyfile" "hardlink" "symlink")' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--help[Print this help menu]' \
        '--dev[Add dependence to "devDependencies]' \
        '-d[Add dependence to "devDependencies]' \
        '-D[]' \
        '--development[]' \
        '--optional[Add dependency to "optionalDependencies]' \
        '--peer[Add dependency to "peerDependencies]' \
        '--exact[Add the exact version instead of the ^range]' &&
        ret=0

    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    package)
        _bun_add_param_package_completion

        ;;
    esac
}

_bun_unlink_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '*: :->package' \
        '--config[Load config(bunfig.toml)]: :->config' \
        '-c[Load config(bunfig.toml)]: :->config' \
        '--yarn[Write a yarn.lock file (yarn v1)]' \
        '-y[Write a yarn.lock file (yarn v1)]' \
        '--production[Don'"'"'t install devDependencies]' \
        '-p[Don'"'"'t install devDependencies]' \
        '--no-save[Don'"'"'t save a lockfile]' \
        '--save[Save to package.json]' \
        '--dry-run[Don'"'"'t install anything]' \
        '--frozen-lockfile[Disallow changes to lockfile]' \
        '--force[Always request the latest versions from the registry & reinstall all dependencies]' \
        '-f[Always request the latest versions from the registry & reinstall all dependencies]' \
        '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
        '--no-cache[Ignore manifest cache entirely]' \
        '--silent[Don'"'"'t log anything]' \
        '--verbose[Excessively verbose logging]' \
        '--no-progress[Disable the progress bar]' \
        '--no-summary[Don'"'"'t print a summary]' \
        '--no-verify[Skip verifying integrity of newly downloaded packages]' \
        '--ignore-scripts[Skip lifecycle scripts in the package.json (dependency scripts are never run)]' \
        '--global[Add a package globally]' \
        '-g[Add a package globally]' \
        '--cwd[Set a specific cwd]:cwd' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:("copyfile" "hardlink" "symlink")' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--help[Print this help menu]' &&
        ret=0

    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    package)
        # TODO: error: bun unlink {packageName} not implemented yet

        ;;
    esac
}

_bun_link_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '*: :->package' \
        '--config[Load config(bunfig.toml)]: :->config' \
        '-c[Load config(bunfig.toml)]: :->config' \
        '--yarn[Write a yarn.lock file (yarn v1)]' \
        '-y[Write a yarn.lock file (yarn v1)]' \
        '--production[Don'"'"'t install devDependencies]' \
        '-p[Don'"'"'t install devDependencies]' \
        '--no-save[Don'"'"'t save a lockfile]' \
        '--save[Save to package.json]' \
        '--dry-run[Don'"'"'t install anything]' \
        '--frozen-lockfile[Disallow changes to lockfile]' \
        '--force[Always request the latest versions from the registry & reinstall all dependencies]' \
        '-f[Always request the latest versions from the registry & reinstall all dependencies]' \
        '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
        '--no-cache[Ignore manifest cache entirely]' \
        '--silent[Don'"'"'t log anything]' \
        '--verbose[Excessively verbose logging]' \
        '--no-progress[Disable the progress bar]' \
        '--no-summary[Don'"'"'t print a summary]' \
        '--no-verify[Skip verifying integrity of newly downloaded packages]' \
        '--ignore-scripts[Skip lifecycle scripts in the package.json (dependency scripts are never run)]' \
        '--global[Add a package globally]' \
        '-g[Add a package globally]' \
        '--cwd[Set a specific cwd]:cwd' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:("copyfile" "hardlink" "symlink")' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--help[Print this help menu]' &&
        ret=0

    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    package)
        _bun_link_param_package_completion

        ;;
    esac
}

_bun_bun_completion() {
    _arguments -s -C \
        '1: :->cmd' \
        '*: :->file' \
        '--version[Show version and exit]' \
        '-V[Show version and exit]' \
        '--cwd[Change directory]:cwd' \
        '--help[Show command help]' \
        '-h[Show command help]' \
        '--use[Use a framework, e.g. "next"]:use' &&
        ret=0

    case $state in
    file)
        _files

        ;;
    esac
}

_bun_init_completion() {
    _arguments -s -C \
        '1: :->cmd' \
        '-y[Answer yes to all prompts]:' \
        '--yes[Answer yes to all prompts]:' &&
        ret=0

}

_bun_create_completion() {
    _arguments -s -C \
        '1: :->cmd' \
        '2: :->cmd2' \
        '*: :->args' &&
        ret=0

    case $state in
    cmd2)
        _alternative 'args:create:((next-app\:"Next.js app" react-app\:"React app"))'

        ;;
    args)
        case $line[2] in
        next)
            pmargs=(
                '1: :->cmd'
                '2: :->cmd2'
                '3: :->file'
                '--force[Overwrite existing files]'
                '--no-install[Don'"'"'t install node_modules]'
                '--no-git[Don'"'"'t create a git repository]'
                '--verbose[verbose]'
                '--no-package-json[Disable package.json transforms]'
                '--open[On finish, start bun & open in-browser]'
            )

            # ---- Command: create next
            _arguments -s -C \
                $pmargs &&
                ret=0

            case $state in
            file)
                _files

                ;;
            esac

            ;;
        react)

            # ---- Command: create react
            _arguments -s -C \
                $pmargs &&
                ret=0

            case $state in
            file)
                _files

                ;;
            esac

            ;;
        *)

            # ---- Command: create from other template
            _arguments -s -C \
                $pmargs &&
                ret=0

            case $state in
            file)
                _files

                ;;
            esac

            ;;
        esac

        ;;

    esac
}

_bun_pm_completion() {
    _arguments -s -C \
        '1: :->cmd' \
        '2: :->cmd2' \
        '*: :->args' &&
        ret=0

    case $state in
    cmd2)
        sub_commands=(
            'bin\:"print the path to bin folder" '
            'ls\:"list the dependency tree according to the current lockfile" '
            'hash\:"generate & print the hash of the current lockfile" '
            'hash-string\:"print the string used to hash the lockfile" '
            'hash-print\:"print the hash stored in the current lockfile" '
            'cache\:"print the path to the cache folder" '
        )

        _alternative "args:cmd3:(($sub_commands))"

        ;;
    args)
        case $line[2] in
        cache)
            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                ':::(rm)' &&
                ret=0

            ;;
        bin)
            pmargs=(
                "-g[print the global path to bin folder]"
            )

            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                $pmargs &&
                ret=0

            ;;
        ls)
            pmargs=(
                "--all[list the entire dependency tree according to the current lockfile]"
            )

            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                $pmargs &&
                ret=0

            ;;
        esac

        ;;
    esac
}

_bun_install_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '--config[Load config(bunfig.toml)]: :->config' \
        '-c[Load config(bunfig.toml)]: :->config' \
        '--yarn[Write a yarn.lock file (yarn v1)]' \
        '-y[Write a yarn.lock file (yarn v1)]' \
        '--production[Don'"'"'t install devDependencies]' \
        '-p[Don'"'"'t install devDependencies]' \
        '--no-save[Don'"'"'t save a lockfile]' \
        '--save[Save to package.json]' \
        '--dry-run[Don'"'"'t install anything]' \
        '--frozen-lockfile[Disallow changes to lockfile]' \
        '--force[Always request the latest versions from the registry & reinstall all dependencies]' \
        '-f[Always request the latest versions from the registry & reinstall all dependencies]' \
        '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
        '--no-cache[Ignore manifest cache entirely]' \
        '--silent[Don'"'"'t log anything]' \
        '--verbose[Excessively verbose logging]' \
        '--no-progress[Disable the progress bar]' \
        '--no-summary[Don'"'"'t print a summary]' \
        '--no-verify[Skip verifying integrity of newly downloaded packages]' \
        '--ignore-scripts[Skip lifecycle scripts in the package.json (dependency scripts are never run)]' \
        '--global[Add a package globally]' \
        '-g[Add a package globally]' \
        '--cwd[Set a specific cwd]:cwd' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:("copyfile" "hardlink" "symlink")' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--help[Print this help menu]' \
        '--dev[Add dependence to "devDependencies]' \
        '-d[Add dependence to "devDependencies]' \
        '--development[]' \
        '-D[]' \
        '--optional[Add dependency to "optionalDependencies]' \
        '--peer[Add dependency to "peerDependencies]' \
        '--exact[Add the exact version instead of the ^range]' &&
        ret=0

    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    esac
}

_bun_remove_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '*: :->package' \
        '--config[Load config(bunfig.toml)]: :->config' \
        '-c[Load config(bunfig.toml)]: :->config' \
        '--yarn[Write a yarn.lock file (yarn v1)]' \
        '-y[Write a yarn.lock file (yarn v1)]' \
        '--production[Don'"'"'t install devDependencies]' \
        '-p[Don'"'"'t install devDependencies]' \
        '--no-save[Don'"'"'t save a lockfile]' \
        '--save[Save to package.json]' \
        '--dry-run[Don'"'"'t install anything]' \
        '--frozen-lockfile[Disallow changes to lockfile]' \
        '--force[Always request the latest versions from the registry & reinstall all dependencies]' \
        '-f[Always request the latest versions from the registry & reinstall all dependencies]' \
        '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
        '--no-cache[Ignore manifest cache entirely]' \
        '--silent[Don'"'"'t log anything]' \
        '--verbose[Excessively verbose logging]' \
        '--no-progress[Disable the progress bar]' \
        '--no-summary[Don'"'"'t print a summary]' \
        '--no-verify[Skip verifying integrity of newly downloaded packages]' \
        '--ignore-scripts[Skip lifecycle scripts in the package.json (dependency scripts are never run)]' \
        '--global[Add a package globally]' \
        '-g[Add a package globally]' \
        '--cwd[Set a specific cwd]:cwd' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:("copyfile" "hardlink" "symlink")' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--help[Print this help menu]' &&
        ret=0

    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    package)
        _bun_remove_param_package_completion

        ;;
    esac
}

_bun_run_completion() {
    _arguments -s -C \
        '1: :->cmd' \
        '2: :->script' \
        '*: :->other' \
        '--help[Display this help and exit]' \
        '-h[Display this help and exit]' \
        '--bun[Force a script or package to use Bun'"'"'s runtime instead of Node.js (via symlinking node)]' \
        '-b[Force a script or package to use Bun'"'"'s runtime instead of Node.js (via symlinking node)]' \
        '--cwd[Absolute path to resolve files & entry points from. This just changes the process cwd]:cwd' \
        '--config[Config file to load bun from (e.g. -c bunfig.toml]: :->config' \
        '-c[Config file to load bun from (e.g. -c bunfig.toml]: :->config' \
        '--env-file[Load environment variables from the specified file(s)]:env-file' \
        '--extension-order[Defaults to: .tsx,.ts,.jsx,.js,.json]:extension-order' \
        '--jsx-factory[Changes the function called when compiling JSX elements using the classic JSX runtime]:jsx-factory' \
        '--jsx-fragment[Changes the function called when compiling JSX fragments]:jsx-fragment' \
        '--jsx-import-source[Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: "react"]:jsx-import-source' \
        '--jsx-runtime["automatic" (default) or "classic"]: :->jsx-runtime' \
        '--preload[Import a module before other modules are loaded]:preload' \
        '-r[Import a module before other modules are loaded]:preload' \
        '--main-fields[Main fields to lookup in package.json. Defaults to --target dependent]:main-fields' \
        '--no-summary[Don'"'"'t print a summary]' \
        '--version[Print version and exit]' \
        '-v[Print version and exit]' \
        '--revision[Print version with revision and exit]' \
        '--tsconfig-override[Load tsconfig from path instead of cwd/tsconfig.json]:tsconfig-override' \
        '--define[Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.]:define' \
        '-d[Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.]:define' \
        '--external[Exclude module from transpilation (can use * wildcards). ex: -e react]:external' \
        '-e[Exclude module from transpilation (can use * wildcards). ex: -e react]:external' \
        '--loader[Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi]:loader' \
        '--packages[Exclude dependencies from bundle, e.g. --packages external. Valid options: bundle, external]:packages' \
        '-l[Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi]:loader' \
        '--origin[Rewrite import URLs to start with --origin. Default: ""]:origin' \
        '-u[Rewrite import URLs to start with --origin. Default: ""]:origin' \
        '--port[Port to serve bun'"'"'s dev server on. Default: '"'"'3000'"'"']:port' \
        '-p[Port to serve bun'"'"'s dev server on. Default: '"'"'3000'"'"']:port' \
        '--smol[Use less memory, but run garbage collection more often]' \
        '--minify[Minify (experimental)]' \
        '--minify-syntax[Minify syntax and inline data (experimental)]' \
        '--minify-whitespace[Minify Whitespace (experimental)]' \
        '--minify-identifiers[Minify identifiers]' \
        '--no-macros[Disable macros from being executed in the bundler, transpiler and runtime]' \
        '--target[The intended execution environment for the bundle. "browser", "bun" or "node"]: :->target' \
        '--inspect[Activate Bun'"'"'s Debugger]:inspect' \
        '--inspect-wait[Activate Bun'"'"'s Debugger, wait for a connection before executing]:inspect-wait' \
        '--inspect-brk[Activate Bun'"'"'s Debugger, set breakpoint on first line of code and wait]:inspect-brk' \
        '--hot[Enable auto reload in bun'"'"'s JavaScript runtime]' \
        '--watch[Automatically restart bun'"'"'s JavaScript runtime on file change]' \
        '--no-install[Disable auto install in bun'"'"'s JavaScript runtime]' \
        '--install[Install dependencies automatically when no node_modules are present, default: "auto". "force" to ignore node_modules, fallback to install any missing]: :->install_' \
        '-i[Automatically install dependencies and use global cache in bun'"'"'s runtime, equivalent to --install=fallback'] \
        '--prefer-offline[Skip staleness checks for packages in bun'"'"'s JavaScript runtime and resolve from disk]' \
        '--prefer-latest[Use the latest matching versions of packages in bun'"'"'s JavaScript runtime, always checking npm]' \
        '--silent[Don'"'"'t repeat the command for bun run]' \
        '--dump-environment-variables[Dump environment variables from .env and process as JSON and quit. Useful for debugging]' \
        '--dump-limits[Dump system limits. Userful for debugging]' &&
        ret=0

    case $state in
    script)
        curcontext="${curcontext%:*:*}:bun-grouped"
        _bun_run_param_script_completion

        ;;
    jsx-runtime)
        _alternative 'args:cmd3:((classic automatic))'

        ;;
    target)
        _alternative 'args:cmd3:((browser bun node))'

        ;;
    install_)
        _alternative 'args:cmd3:((auto force fallback))'

        ;;
    other)
        _files

        ;;
    esac

}

_bun_upgrade_completion() {
    _arguments -s -C \
        '1: :->cmd' \
        '--canary[Upgrade to canary build]' &&
        ret=0

}

_bun_build_completion() {
    _arguments -s -C \
        '1: :->cmd' \
        '*: :->file' \
        '--outfile[Write the output to a specific file (default: stdout)]:outfile' \
        '--outdir[Write the output to a directory (required for splitting)]:outdir' \
        '--minify[Enable all minification flags]' \
        '--minify-whitespace[Remove unneeded whitespace]' \
        '--minify-syntax[Transform code to use less syntax]' \
        '--minify-identifiers[Shorten variable names]' \
        '--sourcemap[Generate sourcemaps]: :->sourcemap' \
        '--target[The intended execution environment for the bundle. "browser", "bun" or "node"]: :->target' \
        '--splitting[Whether to enable code splitting (requires --outdir)]' \
        '--compile[generating a standalone binary from a TypeScript or JavaScript file]' \
        '--format[Specifies the module format to be used in the generated bundles]: :->format' &&
        ret=0

    case $state in
    file)
        _files

        ;;
    target)
        _alternative 'args:cmd3:((browser bun node))'

        ;;
    sourcemap)
        _alternative 'args:cmd3:((none external inline))'

        ;;
    format)

        _alternative 'args:cmd3:((esm cjs iife))'
        ;;
    esac
}

_bun_update_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '-c[Load config(bunfig.toml)]: :->config' \
        '--config[Load config(bunfig.toml)]: :->config' \
        '-y[Write a yarn.lock file (yarn v1)]' \
        '--yarn[Write a yarn.lock file (yarn v1)]' \
        '-p[Don'"'"'t install devDependencies]' \
        '--production[Don'"'"'t install devDependencies]' \
        '--no-save[Don'"'"'t save a lockfile]' \
        '--save[Save to package.json]' \
        '--dry-run[Don'"'"'t install anything]' \
        '--frozen-lockfile[Disallow changes to lockfile]' \
        '-f[Always request the latest versions from the registry & reinstall all dependencies]' \
        '--force[Always request the latest versions from the registry & reinstall all dependencies]' \
        '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
        '--no-cache[Ignore manifest cache entirely]' \
        '--silent[Don'"'"'t log anything]' \
        '--verbose[Excessively verbose logging]' \
        '--no-progress[Disable the progress bar]' \
        '--no-summary[Don'"'"'t print a summary]' \
        '--no-verify[Skip verifying integrity of newly downloaded packages]' \
        '--ignore-scripts[Skip lifecycle scripts in the package.json (dependency scripts are never run)]' \
        '-g[Add a package globally]' \
        '--global[Add a package globally]' \
        '--cwd[Set a specific cwd]:cwd' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:("copyfile" "hardlink" "symlink")' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--help[Print this help menu]' &&
        ret=0

    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    esac
}

_bun_outdated_completion() {
    _arguments -s -C \
        '--cwd[Set a specific cwd]:cwd' \
        '--verbose[Excessively verbose logging]' \
        '--no-progress[Disable the progress bar]' \
        '--help[Print this help menu]' &&
        ret=0
    
    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    esac
}

_bun_test_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '*: :->file' \
        '-h[Display this help and exit]' \
        '--help[Display this help and exit]' \
        '-b[Force a script or package to use Bun.js instead of Node.js (via symlinking node)]' \
        '--bun[Force a script or package to use Bun.js instead of Node.js (via symlinking node)]' \
        '--cwd[Set a specific cwd]:cwd' \
        '-c[Load config(bunfig.toml)]: :->config' \
        '--config[Load config(bunfig.toml)]: :->config' \
        '--env-file[Load environment variables from the specified file(s)]:env-file' \
        '--extension-order[Defaults to: .tsx,.ts,.jsx,.js,.json]:extension-order' \
        '--jsx-factory[Changes the function called when compiling JSX elements using the classic JSX runtime]:jsx-factory' \
        '--jsx-fragment[Changes the function called when compiling JSX fragments]:jsx-fragment' \
        '--jsx-import-source[Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: "react"]:jsx-import-source' \
        '--jsx-runtime["automatic" (default) or "classic"]: :->jsx-runtime' \
        '--preload[Import a module before other modules are loaded]:preload' \
        '-r[Import a module before other modules are loaded]:preload' \
        '--main-fields[Main fields to lookup in package.json. Defaults to --target dependent]:main-fields' \
        '--no-summary[Don'"'"'t print a summary]' \
        '--version[Print version and exit]' \
        '-v[Print version and exit]' \
        '--revision[Print version with revision and exit]' \
        '--tsconfig-override[Load tsconfig from path instead of cwd/tsconfig.json]:tsconfig-override' \
        '--define[Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.]:define' \
        '-d[Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.]:define' \
        '--external[Exclude module from transpilation (can use * wildcards). ex: -e react]:external' \
        '-e[Exclude module from transpilation (can use * wildcards). ex: -e react]:external' \
        '--loader[Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi]:loader' \
        '-l[Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi]:loader' \
        '--origin[Rewrite import URLs to start with --origin. Default: ""]:origin' \
        '-u[Rewrite import URLs to start with --origin. Default: ""]:origin' \
        '--port[Port to serve bun'"'"'s dev server on. Default: '"'"'3000'"'"']:port' \
        '-p[Port to serve bun'"'"'s dev server on. Default: '"'"'3000'"'"']:port' \
        '--smol[Use less memory, but run garbage collection more often]' \
        '--minify[Minify (experimental)]' \
        '--minify-syntax[Minify syntax and inline data (experimental)]' \
        '--minify-identifiers[Minify identifiers]' \
        '--no-macros[Disable macros from being executed in the bundler, transpiler and runtime]' \
        '--target[The intended execution environment for the bundle. "browser", "bun" or "node"]: :->target' \
        '--inspect[Activate Bun'"'"'s Debugger]:inspect' \
        '--inspect-wait[Activate Bun'"'"'s Debugger, wait for a connection before executing]:inspect-wait' \
        '--inspect-brk[Activate Bun'"'"'s Debugger, set breakpoint on first line of code and wait]:inspect-brk' \
        '--watch[Automatically restart bun'"'"'s JavaScript runtime on file change]' \
        '--timeout[Set the per-test timeout in milliseconds, default is 5000.]:timeout' \
        '--update-snapshots[Update snapshot files]' \
        '--rerun-each[Re-run each test file <NUMBER> times, helps catch certain bugs]:rerun' \
        '--only[Only run tests that are marked with "test.only()"]' \
        '--todo[Include tests that are marked with "test.todo()"]' \
        '--coverage[Generate a coverage profile]' \
        '--bail[Exit the test suite after <NUMBER> failures. If you do not specify a number, it defaults to 1.]:bail' \
        '--test-name-pattern[Run only tests with a name that matches the given regex]:pattern' \
        '-t[Run only tests with a name that matches the given regex]:pattern' &&
        ret=0

    case $state in
    file)
        _bun_test_param_script_completion

        ;;
    config)
        _files

        ;;

    esac

}

_bun() {
    zstyle ':completion:*:*:bun:*' group-name ''
    zstyle ':completion:*:*:bun-grouped:*' group-name ''

    zstyle ':completion:*:*:bun::descriptions' format '%F{green}-- %d --%f'
    zstyle ':completion:*:*:bun-grouped:*' format '%F{green}-- %d --%f'
    # zstyle ':completion:*:options' list-colors '=^(-- *)=34'

    local program=bun
    typeset -A opt_args
    local curcontext="$curcontext" state line context

    # ---- Command:
    _arguments -s \
        '1: :->cmd' \
        '*: :->args' &&
        ret=0

    case $state in
    cmd)
        local -a scripts_list
        IFS=$'\n' scripts_list=($(SHELL=zsh bun getcompletes i))
        scripts="scripts:scripts:((${scripts_list//:/\\\\:}))"
        IFS=$'\n' files_list=($(SHELL=zsh bun getcompletes j))

        main_commands=(
            'run\:"Run JavaScript with Bun, a package.json script, or a bin" '
            'test\:"Run unit tests with Bun" '
            'x\:"Install and execute a package bin (bunx)" '
            'repl\:"Start a REPL session with Bun" '
            'init\:"Start an empty Bun project from a blank template" '
            'create\:"Create a new project from a template (bun c)" '
            'install\:"Install dependencies for a package.json (bun i)" '
            'add\:"Add a dependency to package.json (bun a)" '
            'remove\:"Remove a dependency from package.json (bun rm)" '
            'update\:"Update outdated dependencies & save to package.json" '
            'outdated\:"Display the latest versions of outdated dependencies" '
            'link\:"Link an npm package globally" '
            'unlink\:"Globally unlink an npm package" '
            'pm\:"More commands for managing packages" '
            'build\:"Bundle TypeScript & JavaScript into a single file" '
            'upgrade\:"Get the latest version of bun" '
            'help\:"Show all supported flags and commands" '
        )
        main_commands=($main_commands)
        _alternative "$scripts" "args:command:(($main_commands))" "files:files:(($files_list))"

        ;;
    args)
        case $line[1] in
        add|a)
            _bun_add_completion

            ;;
        unlink)
            _bun_unlink_completion

            ;;
        link)
            _bun_link_completion

            ;;
        bun)
            _bun_bun_completion

            ;;
        init)
            _bun_init_completion

            ;;
        create|c)
            _bun_create_completion

            ;;
        x)
            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                '*: :->args' &&
                ret=0
            ;;
        pm)
            _bun_pm_completion

            ;;
        install|i)
            _bun_install_completion

            ;;
        remove|rm)
            _bun_remove_completion

            ;;
        run)
            _bun_run_completion

            ;;
        upgrade)
            _bun_upgrade_completion

            ;;
        build)
            _bun_build_completion

            ;;
        update)
            _bun_update_completion

            ;;
        outdated)
            _bun_outdated_completion

            ;;
        'test')
            _bun_test_completion

            ;;
        help)
            # ---- Command: help
            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                '*: :->args' &&
                ret=0

            case $state in
            cmd2)
                curcontext="${curcontext%:*:*}:bun-grouped"
                _alternative "args:command:(($main_commands))"

                ;;
            args)
                case $line[2] in
                add)
                    _bun_add_completion

                    ;;
                unlink)
                    _bun_unlink_completion

                    ;;
                link)
                    _bun_link_completion

                    ;;
                bun)
                    _bun_bun_completion

                    ;;
                init)
                    _bun_init_completion

                    ;;
                create)
                    _bun_create_completion

                    ;;
                x)
                    _arguments -s -C \
                        '1: :->cmd' \
                        '2: :->cmd2' \
                        '*: :->args' &&
                        ret=0
                    ;;
                pm)
                    _bun_pm_completion

                    ;;
                install)
                    _bun_install_completion

                    ;;
                remove)
                    _bun_remove_completion

                    ;;
                run)
                    _bun_run_completion

                    ;;
                upgrade)
                    _bun_upgrade_completion

                    ;;
                build)
                    _bun_build_completion

                    ;;
                update)
                    _bun_update_completion

                    ;;
                outdated)
                    _bun_outdated_completion

                    ;;
                'test')
                    _bun_test_completion

                    ;;
                esac

                ;;
            esac

            ;;
        esac

        ;;
    esac
}

_bun_list_bunfig_toml() {
    # _alternative "files:file:_files -g '*.toml'"
    _files
}

_bun_run_param_script_completion() {
    local -a scripts_list
    IFS=$'\n' scripts_list=($(SHELL=zsh bun getcompletes s))
    IFS=$'\n' bins=($(SHELL=zsh bun getcompletes b))

    _alternative "scripts:scripts:((${scripts_list//:/\\\\:}))"
    _alternative "bin:bin:((${bins//:/\\\\:}))"
    _alternative "files:file:_files -g '*.(js|ts|jsx|tsx|wasm)'"
}

_bun_link_param_package_completion() {
    # Read packages from ~/.bun/install/global/node_modules
    install_env=$BUN_INSTALL
    install_dir=${(P)install_env:-$HOME/.bun}
    global_node_modules=$install_dir/install/global/node_modules

    local -a packages_full_path=(${global_node_modules}/*(N))
    packages=$(echo $packages_full_path | tr ' ' '\n' | xargs  basename)
    _alternative "dirs:directory:(($packages))"
}

_bun_remove_param_package_completion() {
    if ! command -v jq &>/dev/null; then
        return
    fi

    # TODO: move to "bun getcompletes"
    if [ -f "package.json" ]; then
        local dependencies=$(jq -r '.dependencies | keys[]' package.json)
        local dev_dependencies=$(jq -r '.devDependencies | keys[]' package.json)
        _alternative "deps:dependency:(($dependencies))"
        _alternative "deps:dependency:(($dev_dependencies))"
    fi
}

_bun_test_param_script_completion() {
    local -a scripts_list

    _alternative "files:file:_files -g '*(_|.)(test|spec).(js|ts|jsx|tsx)'"
}

_set_remove() {
    comm -23 <(echo $1 | sort | tr " " "\n") <(echo $2 | sort | tr " " "\n") 2>/dev/null
}

_bun_add_param_package_completion() {

    IFS=$'\n' inexact=($(history -n bun | grep -E "^bun add " | cut -c 9- | uniq))
    IFS=$'\n' exact=($($inexact | grep -E "^$words[$CURRENT]"))
    IFS=$'\n' packages=($(SHELL=zsh bun getcompletes a $words[$CURRENT]))

    to_print=$inexact
    if [ ! -z "$exact" -a "$exact" != " " ]; then
        to_print=$exact
    fi

    if [ ! -z "$to_print" -a "$to_print" != " " ]; then
        if [ ! -z "$packages" -a "$packages" != " " ]; then
            _describe -1 -t to_print 'History' to_print
            _describe -1 -t packages "Popular" packages
            return
        fi

        _describe -1 -t to_print 'History' to_print
        return
    fi

    if [ ! -z "$packages" -a "$packages" != " " ]; then
        _describe -1 -t packages "Popular" packages
        return
    fi

}

__bun_dynamic_comp() {
    local comp=""

    for arg in scripts; do
        local line
        while read -r line; do
            local name="$line"
            local desc="$line"
            name="${name%$'\t'*}"
            desc="${desc/*$'\t'/}"
            echo
        done <<<"$arg"
    done

    return $comp
}

if ! command -v compinit >/dev/null; then
    autoload -U compinit && compinit
fi

compdef _bun bun
