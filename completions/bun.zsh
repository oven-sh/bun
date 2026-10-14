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
        '--exact[Add the exact version instead of the ^range]' \
        '--catalog=-[Add the resolved version to the root package.json catalog and depend on it as "catalog:"]:catalog' \
        '*--filter[Add the package(s) to the matching workspaces instead of the current package]:workspace pattern' \
        '*-F[Add the package(s) to the matching workspaces instead of the current package]:workspace pattern' &&
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
            'licenses\:"list installed packages grouped by license" '
            'hash\:"generate & print the hash of the current lockfile" '
            'hash-string\:"print the string used to hash the lockfile" '
            'hash-print\:"print the hash stored in the current lockfile" '
            'cache\:"print the path to the cache folder" '
            'version\:"bump the version in package.json and create a git tag" '
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
                "--trusted[list only trusted dependencies]"
            )

            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                $pmargs &&
                ret=0

            ;;
        licenses)
            pmargs=(
                "--json[output as JSON]"
                "--prod[omit devDependencies]"
                "--production[omit devDependencies]"
                "--dev[list only what devDependencies pull in]"
                "-D[list only what devDependencies pull in]"
                "--long[also print author, description and homepage]"
                "*--filter[list only the matching workspaces' dependencies]:workspace pattern"
                "*-F[list only the matching workspaces' dependencies]:workspace pattern"
            )

            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                $pmargs &&
                ret=0

            ;;
        version)
            version_args=(
                "patch[increment patch version]"
                "minor[increment minor version]"
                "major[increment major version]"
                "prepatch[increment patch version and add pre-release]"
                "preminor[increment minor version and add pre-release]"
                "premajor[increment major version and add pre-release]"
                "prerelease[increment pre-release version]"
                "from-git[use version from latest git tag]"
            )

            pmargs=(
                "--no-git-tag-version[don't create a git commit and tag]"
                "--allow-same-version[allow bumping to the same version]"
                "-m[use the given message for the commit]:message"
                "--message[use the given message for the commit]:message"
                "--preid[identifier to prefix pre-release versions]:preid"
            )

            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                '3: :->increment' \
                $pmargs &&
                ret=0

            case $state in
            increment)
                _alternative "args:increment:(($version_args))"
                ;;
            esac

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
        '--exact[Add the exact version instead of the ^range]' \
        '--catalog=-[Add the resolved version to the root package.json catalog and depend on it as "catalog:"]:catalog' \
        '*--filter[Install packages for the matching workspaces]:workspace pattern' \
        '*-F[Install packages for the matching workspaces]:workspace pattern' &&
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
        '--help[Print this help menu]' \
        '*--filter[Remove the package(s) from the matching workspaces instead of the current package]:workspace pattern' \
        '*-F[Remove the package(s) from the matching workspaces instead of the current package]:workspace pattern' &&
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
        '--silent[Don'"'"'t repeat the command for bun run]' &&
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

_bun_repl_completion() {
    _arguments -s -C \
        '1: :->cmd' \
        '--help[Print this help menu]' \
        '-h[Print this help menu]' \
        '(-p --print)--eval[Evaluate argument as a script, then exit]:script' \
        '(-p --print)-e[Evaluate argument as a script, then exit]:script' \
        '(-e --eval)--print[Evaluate argument as a script, print the result, then exit]:script' \
        '(-e --eval)-p[Evaluate argument as a script, print the result, then exit]:script' \
        '--preload[Import a module before other modules are loaded]:preload' \
        '-r[Import a module before other modules are loaded]:preload' \
        '--smol[Use less memory, but run garbage collection more often]' \
        '--config[Specify path to Bun config file]: :->config' \
        '-c[Specify path to Bun config file]: :->config' \
        '--cwd[Absolute path to resolve files & entry points from]:cwd' \
        '--env-file[Load environment variables from the specified file(s)]:env-file' \
        '--no-env-file[Disable automatic loading of .env files]' &&
        ret=0

    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    esac
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
        '-p[Only update dependencies and optionalDependencies]' \
        '--production[Only update dependencies and optionalDependencies]' \
        '-P[Only update dependencies and optionalDependencies]' \
        '--prod[Only update dependencies and optionalDependencies]' \
        '-d[Only update devDependencies]' \
        '--dev[Only update devDependencies]' \
        '-D[Only update devDependencies]' \
        '--development[Only update devDependencies]' \
        '--no-optional[Don'"'"'t update optionalDependencies]' \
        '-E[Write exact versions to package.json instead of ^ or ~ ranges]' \
        '--exact[Write exact versions to package.json instead of ^ or ~ ranges]' \
        '--no-save[Don'"'"'t save a lockfile]' \
        '--save[Save to package.json]' \
        '--dry-run[Don'"'"'t install anything]' \
        '--frozen-lockfile[Disallow changes to lockfile]' \
        '-L[Update packages to their latest versions, ignoring the ranges in package.json]' \
        '--latest[Update packages to their latest versions, ignoring the ranges in package.json]' \
        '-i[Show an interactive list of outdated packages to select for update]' \
        '--interactive[Show an interactive list of outdated packages to select for update]' \
        '-r[Update packages in all workspaces]' \
        '--recursive[Update packages in all workspaces]' \
        '*--filter[Update packages for the matching workspaces]:workspace pattern' \
        '*-F[Update packages for the matching workspaces]:workspace pattern' \
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

_bun_dedupe_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '--check[Exit with code 1 if the lockfile has duplicate versions that can be removed, without changing anything]' \
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
        '--lockfile-only[Generate a lockfile without installing dependencies]' \
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
        '--cwd[Set a specific cwd]:cwd' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:("copyfile" "hardlink" "symlink")' \
        '--linker[Linker strategy]:linker:(isolated hoisted)' \
        '--help[Print this help menu]' &&
        ret=0

    case $state in
    config)
        _bun_list_bunfig_toml

        ;;
    esac
}

_bun_prune_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '-p[Also remove packages that are only needed by devDependencies]' \
        '--production[Also remove packages that are only needed by devDependencies]' \
        '-P[Also remove packages that are only needed by devDependencies]' \
        '--prod[Also remove packages that are only needed by devDependencies]' \
        '*--omit[Also remove packages that are only needed by the given dependency types]:type:(dev optional peer)' \
        '--dry-run[Print what would be removed without deleting anything]' \
        '*--os[Prune for a different operating system than the current one]:os' \
        '*--cpu[Prune for a different CPU architecture than the current one]:cpu' \
        '--linker[Linker to assume when node_modules mixes isolated and hoisted installs]:linker:(isolated hoisted)' \
        '*--filter[Only prune the node_modules folders of the matching workspaces]:workspace pattern' \
        '*-F[Only prune the node_modules folders of the matching workspaces]:workspace pattern' \
        '--silent[Don'"'"'t log anything]' \
        '--cwd[Set a specific cwd]:cwd' \
        '-h[Print this help menu]' \
        '--help[Print this help menu]' &&
        ret=0
}

_bun_check_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '*: :_files' \
        '--project[Path to a tsconfig.json or its directory]:project:_files' \
        '-p[Path to a tsconfig.json or its directory]:project:_files' \
        '--pretty[Show source code around each error]' \
        '--no-pretty[One line per error]' \
        '--all[Show every error]' \
        '--threads[Number of threads]:threads' \
        '--timing[Print load and check times]' \
        '--cwd[Set the working directory]:cwd:_files -/' \
        '--help[Print this help menu]' \
        '-h[Print this help menu]' &&
        ret=0
}

_bun_lint_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '*: :_files' \
        '--config[Use this config file instead of looking for one]:config:_files' \
        '-c[Use this config file instead of looking for one]:config:_files' \
        '--no-config-lookup[Do not look for a config file]' \
        '--rule[Set a rule\: --rule '"'"'eqeqeq\: \[error, smart\]'"'"']:rule' \
        '--rules[List the built-in rules]' \
        '--explain[Print the documentation of a rule]:explain' \
        '--init[Add a \[lint\] section to bunfig.toml]' \
        '--global[Define global variables\: --global a,b\:true]:global' \
        '--no-inline-config[Ignore eslint-disable and other config comments]' \
        '--report-unused-disable-directives[Report eslint-disable comments that disable nothing]' \
        '--print-config[Print the config for a file and exit]:print-config:_files' \
        '--doctor[Show which rules run natively and which packages you can remove]' \
        '--allow-unsupported[Warn instead of failing when the config has a rule or file that is not supported]' \
        '--staged[Only lint files that are staged in git]' \
        '--changed[Only lint files that differ from a branch or commit (default\: the default branch)]' \
        '--ignore-pattern[Skip files that match this pattern]:ignore-pattern' \
        '--ignore-path[Read ignore patterns from this file instead of .eslintignore]:ignore-path:_files' \
        '--no-ignore[Lint ignored files too]' \
        '--ext[Also lint files with these extensions]:ext' \
        '--stdin[Lint code from standard input]' \
        '--stdin-filename[The file name to use for code from standard input]:stdin-filename:_files' \
        '--list-files[Print the files that would be linted and exit]' \
        '--no-error-on-unmatched-pattern[Do not fail when an argument matches no file]' \
        '--cwd[Set the working directory]:cwd:_files -/' \
        '--format[pretty (default), stylish, json, json-with-metadata, unix, github, agent, checkstyle, junit, gitlab, sarif]:format' \
        '-f[pretty (default), stylish, json, json-with-metadata, unix, github, agent, checkstyle, junit, gitlab, sarif]:format' \
        '--all[Show every problem (pretty and agent group identical problems above 50)]' \
        '--output-file[Write the report to a file]:output-file:_files' \
        '-o[Write the report to a file]:output-file:_files' \
        '--quiet[Report errors only]' \
        '--max-warnings[Exit with 1 if there are more warnings than this]:max-warnings' \
        '--color[Always use colors]' \
        '--no-color[Never use colors]' \
        '--timing[Print how long each phase took]' \
        '--fix[Fix problems and write the files]' \
        '--fix-dry-run[Fix without writing. The json format has the fixed code]' \
        '--fix-type[Only apply fixes from rules of these types\: directive, problem, suggestion, layout]:fix-type' \
        '--fix-suggestions[Apply suggestions]' \
        '--fix-dangerously[Apply every fix and suggestion, even those that can change behavior]' \
        '--type-aware[Also run the rules that need types]' \
        '--no-type-aware[Skip the rules that need types]' \
        '--tsconfig[Use this tsconfig.json for the rules that need types]:tsconfig:_files' \
        '--type-check[With --type-aware, report type errors too]' \
        '--infer-globals[Also treat what the project'"'"'s types declare as globals]' \
        '--no-infer-globals[Do not take globals from the project'"'"'s types]' \
        '--threads[Number of threads (default\: one per CPU core)]:threads' \
        '--version[Print the version of Bun]' \
        '-v[Print the version of Bun]' \
        '--help[Print the common flags. With --all, every flag]' \
        '-h[Print the common flags. With --all, every flag]' \
        '--help-all[The same as --help --all]' \
        '--flavor[Use the eslint or the oxlint config in a project that has both]:flavor' \
        '--project[The same as --tsconfig]:project:_files' \
        '-p[The same as --tsconfig]:project:_files' \
        '--parser-options[Set parser options\: --parser-options projectService\:true]:parser-options' \
        '--parser[Parse files with this package]:parser' \
        '--plugin[Load these plugins]:plugin' \
        '--native-plugin-rules[Use the built-in rules for these plugins only\: import,react-hooks (default\: all)]:native-plugin-rules' \
        '--no-native-plugin-rules[Run plugin rules from the installed packages, in JavaScript]' \
        '--report-unused-disable-directives-severity[Report unused eslint-disable comments as off, warn or error]:report-unused-disable-directives-severity' \
        '--report-unused-inline-configs[Report config comments that change nothing]:report-unused-inline-configs' \
        '--no-warn-ignored[Do not warn when an argument names an ignored file]' \
        '--suppress-all[Record the current errors in eslint-suppressions.json and stop reporting them]' \
        '--suppress-rule[The same, for the errors of one rule]:suppress-rule' \
        '--suppressions-location[Use this file instead of eslint-suppressions.json]:suppressions-location:_files' \
        '--prune-suppressions[Remove recorded errors that no longer occur from that file]' \
        '--pass-on-unpruned-suppressions[Do not fail when that file has errors that no longer occur]' \
        '--pass-on-no-patterns[Exit with 0 when there are no arguments, instead of linting .]' \
        '--exit-on-fatal-error[Exit with 2 if a file cannot be parsed]' \
        '--concurrency[The same as --threads]:concurrency' \
        '--env-info[Print the versions of Bun, ESLint and TypeScript]' \
        '--no-eslintrc[ESLint 8\: do not look for .eslintrc files]' \
        '--env[ESLint 8\: turn on these environments]:env' \
        '--rulesdir[ESLint 8\: load rules from these directories]:rulesdir:_files' \
        '--resolve-plugins-relative-to[ESLint 8\: look for plugins from this directory]:resolve-plugins-relative-to:_files' \
        '--allow[Turn off a rule or a category]:allow' \
        '-A[Turn off a rule or a category]:allow' \
        '--warn[Make a rule or a category a warning]:warn' \
        '-W[Make a rule or a category a warning]:warn' \
        '--deny[Make a rule or a category an error]:deny' \
        '-D[Make a rule or a category an error]:deny' \
        '--deny-warnings[Exit with 1 if there are warnings]' \
        '--silent[Print no problems]' \
        '--disable-nested-config[Use the config file in the working directory for every file]' \
        '--import-plugin[Turn on the import plugin]' \
        '--react-plugin[Turn on the react plugin]' \
        '--jsdoc-plugin[Turn on the jsdoc plugin]' \
        '--jest-plugin[Turn on the jest plugin]' \
        '--vitest-plugin[Turn on the vitest plugin]' \
        '--jsx-a11y-plugin[Turn on the jsx-a11y plugin]' \
        '--nextjs-plugin[Turn on the nextjs plugin]' \
        '--react-perf-plugin[Turn on the react-perf plugin]' \
        '--promise-plugin[Turn on the promise plugin]' \
        '--node-plugin[Turn on the node plugin]' \
        '--vue-plugin[Turn on the vue plugin]' \
        '--disable-unicorn-plugin[Turn off the unicorn plugin]' \
        '--disable-oxc-plugin[Turn off the oxc plugin]' \
        '--disable-typescript-plugin[Turn off the typescript plugin]' &&
        ret=0
}

_bun_fmt_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '*: :_files' \
        '--config[Use this config file instead of looking for one]:config:_files' \
        '--no-config[Do not look for a config file]' \
        '--no-editorconfig[Do not read .editorconfig]' \
        '--init[Add a \[fmt\] section to bunfig.toml]' \
        '--doctor[Show which files are formatted natively and which packages you can remove]' \
        '--print-width[The line length to wrap at (default\: 80)]:print-width' \
        '--tab-width[Spaces per indentation level (default\: 2)]:tab-width' \
        '--use-tabs[Indent with tabs]' \
        '--no-semi[Only print semicolons where they are needed]' \
        '--single-quote[Use single quotes]' \
        '--jsx-single-quote[Use single quotes in JSX]' \
        '--quote-props[as-needed (default), consistent, or preserve]:quote-props' \
        '--trailing-comma[all (default), es5, or none]:trailing-comma' \
        '--no-bracket-spacing[No spaces inside the braces of an object literal]' \
        '--bracket-same-line[Put the closing bracket of a multi-line element at the end of the last line]' \
        '--arrow-parens[always (default) or avoid]:arrow-parens' \
        '--object-wrap[preserve (default) or collapse]:object-wrap' \
        '--single-attribute-per-line[One attribute per line in HTML, Vue, and JSX]' \
        '--html-whitespace-sensitivity[css (default), strict, or ignore]:html-whitespace-sensitivity' \
        '--vue-indent-script-and-style[Indent the code in the script and style tags of Vue files]' \
        '--prose-wrap[preserve (default), always, or never]:prose-wrap' \
        '--embedded-language-formatting[auto (default) or off]:embedded-language-formatting' \
        '--end-of-line[lf (default), crlf, cr, or auto]:end-of-line' \
        '--no-insert-final-newline[Do not end files with a newline]' \
        '--sort-imports[Sort and group imports]' \
        '--sort-tailwindcss[Sort Tailwind CSS classes]' \
        '--sort-package-json[Sort the keys of package.json]' \
        '--jsdoc[Format JSDoc comments]' \
        '--svelte[Format Svelte components (default without a Prettier or oxfmt config)]' \
        '--no-svelte[Do not format Svelte components]' \
        '--staged[Only format files that are staged in git, and stage them again]' \
        '--changed[Only format files that differ from a branch or commit (default\: the default branch)]' \
        '--stdin-filepath[Format standard input as this file and print the result]:stdin-filepath:_files' \
        '--ignore-path[Read ignore patterns from these files (default\: .gitignore and .prettierignore)]:ignore-path:_files' \
        '--ignore-pattern[Skip files that match this pattern]:ignore-pattern' \
        '--with-node-modules[Format files in node_modules too]' \
        '--no-error-on-unmatched-pattern[Do not fail when an argument matches no file]' \
        '--ignore-unknown[Ignore files in an unknown language]' \
        '-u[Ignore files in an unknown language]' \
        '--allow-unsupported[Warn instead of failing when the language of a file is not supported]' \
        '--list-files[Print the files that would be formatted and exit]' \
        '--cwd[Set the working directory]:cwd:_files -/' \
        '--check[Do not write. Exit with 1 if a file needs formatting]' \
        '-c[Do not write. Exit with 1 if a file needs formatting]' \
        '--list-different[Do not write. Print the files that need formatting and exit with 1 if there are any]' \
        '-l[Do not write. Print the files that need formatting and exit with 1 if there are any]' \
        '--log-level[silent, error, warn, log (default), or debug]:log-level' \
        '--format[With --doctor, print the report as json]:format' \
        '-f[With --doctor, print the report as json]:format' \
        '--color[Always use colors]' \
        '--no-color[Never use colors]' \
        '--timing[Print how long each phase took]' \
        '--threads[Number of threads (default\: one per CPU core)]:threads' \
        '--debug-check[Do not write. Fail if formatting a file would change what it means]' \
        '--version[Print the version of Bun]' \
        '-v[Print the version of Bun]' \
        '--help[Print the common flags. With --all, every flag]' \
        '-h[Print the common flags. With --all, every flag]' \
        '--all[With --help, print every flag]' \
        '--help-all[The same as --help --all]' \
        '--write[Write the files. This is the default]' \
        '-w[Write the files. This is the default]' \
        '--config-precedence[cli-override (default), file-override, or prefer-file]:config-precedence' \
        '--find-config-path[Print the path of the config for a file and exit]:find-config-path:_files' \
        '--parser[Read every file with this parser]:parser' \
        '--plugin[Load these plugins]:plugin' \
        '--require-pragma[Only format files that start with a @format or @prettier comment]' \
        '--check-ignore-pragma[Skip files that start with a @noformat or @noprettier comment]' \
        '--insert-pragma[Put a @format comment at the top of formatted files]' \
        '--range-start[Only format the statements from this offset on]:range-start' \
        '--range-end[Only format the statements up to this offset]:range-end' \
        '--cursor-offset[With --stdin-filepath, print on stderr where this offset ends up]:cursor-offset' \
        '--experimental-ternaries[Put the question mark of a ternary after the condition]' \
        '--experimental-operator-position[end (default) or start]:experimental-operator-position' \
        '--jsx-bracket-same-line[The old name of --bracket-same-line]' \
        '--flavor[Without a config file, format like prettier or like oxfmt]:flavor' \
        '--disable-nested-config[Use the config file in the working directory for every file]' &&
        ret=0
}

_bun_audit_completion() {
    _arguments -s -C \
        '1: :->cmd1' \
        '2: :->subcommand' \
        '--json[Output in JSON format]' \
        '--audit-level[Only print advisories with severity greater than or equal to the given level]:level:(low moderate high critical)' \
        '*--ignore[Ignore advisories by GHSA or numeric advisory ID]:advisory' \
        '--prod[Omit devDependencies]' \
        '--production[Omit devDependencies]' \
        '*--omit[Exclude dependency types from the audit]:type:(dev optional peer)' \
        '--dry-run[Show what bun audit fix would change without changing anything]' \
        '--latest[Let bun audit fix update direct dependencies past their declared ranges]' \
        '-L[Let bun audit fix update direct dependencies past their declared ranges]' \
        '--cwd[Set a specific cwd]:cwd' \
        '--help[Print this help menu]' &&
        ret=0

    case $state in
    subcommand)
        _alternative 'args:subcommand:((fix\:"Upgrade vulnerable packages to the lowest safe version"))'

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
        '--retry[Default retry count for all tests]:retry' \
        '--todo[Include tests that are marked with "test.todo()"]' \
        '--coverage[Generate a coverage profile]' \
        '--bail[Exit the test suite after <NUMBER> failures. If you do not specify a number, it defaults to 1.]:bail' \
        '--shard[Run a subset of test files, e.g. 1/3. Useful for splitting tests across CI jobs.]:shard' \
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
        scripts="scripts:scripts:compadd -a scripts_list"
        local -a files_list
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
            'audit\:"Check installed packages for vulnerabilities" '
            'check\:"Type check a TypeScript project" '
            'lint\:"Lint JavaScript and TypeScript" '
            'fmt\:"Format code the way Prettier does" '
            'dedupe\:"Remove duplicate versions from the lockfile" '
            'prune\:"Remove packages that are not in the lockfile from node_modules" '
            'outdated\:"Display the latest versions of outdated dependencies" '
            'link\:"Link an npm package globally" '
            'unlink\:"Globally unlink an npm package" '
            'pm\:"More commands for managing packages" '
            'build\:"Bundle TypeScript & JavaScript into a single file" '
            'upgrade\:"Get the latest version of bun" '
            'help\:"Show all supported flags and commands" '
        )
        main_commands=($main_commands)
        _alternative "$scripts" "args:command:(($main_commands))" "files:files:compadd -a files_list"

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
        repl)
            _bun_repl_completion

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
        audit)
            _bun_audit_completion

            ;;
        check)
            _bun_check_completion

            ;;
        lint)
            _bun_lint_completion

            ;;
        fmt)
            _bun_fmt_completion

            ;;
        dedupe)
            _bun_dedupe_completion

            ;;
        prune)
            _bun_prune_completion

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
                repl)
                    _bun_repl_completion

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
                audit)
                    _bun_audit_completion

                    ;;
                check)
                    _bun_check_completion

                    ;;
                lint)
                    _bun_lint_completion

                    ;;
                fmt)
                    _bun_fmt_completion

                    ;;
                dedupe)
                    _bun_dedupe_completion

                    ;;
                prune)
                    _bun_prune_completion

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
    local -a scripts_list bins
    IFS=$'\n' scripts_list=($(SHELL=zsh bun getcompletes s))
    IFS=$'\n' bins=($(SHELL=zsh bun getcompletes b))

    _alternative "scripts:scripts:compadd -a scripts_list"
    _alternative "bin:bin:compadd -a bins"
    _alternative "files:file:_files -g '*.(js|ts|jsx|tsx|wasm)'"
}

_bun_link_param_package_completion() {
    # Read packages from ~/.bun/install/global/node_modules
    install_env=$BUN_INSTALL
    install_dir=${(P)install_env:-$HOME/.bun}
    global_node_modules=$install_dir/install/global/node_modules

    local -a packages_full_path=(${global_node_modules}/*(N))
    local -a packages=(${packages_full_path:t})
    _alternative "dirs:directory:compadd -a packages"
}

_bun_remove_param_package_completion() {
    if ! command -v jq &>/dev/null; then
        return
    fi

    # TODO: move to "bun getcompletes"
    if [ -f "package.json" ]; then
        local -a dependencies dev_dependencies
        IFS=$'\n' dependencies=($(jq -r '.dependencies | keys[]' package.json))
        IFS=$'\n' dev_dependencies=($(jq -r '.devDependencies | keys[]' package.json))
        _alternative "deps:dependency:compadd -a dependencies"
        _alternative "deps:dependency:compadd -a dev_dependencies"
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
