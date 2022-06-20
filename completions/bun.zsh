_bun() {
    zstyle ':completion:*:*:bun:*' group-name ''
    zstyle ':completion:*:*:bun-grouped:*' group-name ''
    
    zstyle ':completion:*:*:bun::descriptions' format '%F{green}-- %d --%f'
    zstyle ':completion:*:*:bun-grouped:*' format '%F{green}-- %d --%f'
    
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
        scripts="scripts:scripts:(($scripts_list))"

        main_commands=('add\:"Add a dependency to package.json" bun\:"Generate a bundle" create\:"Create a new project" dev\:"Start a dev server" help\:"Show command help" install\:"Install packages from package.json" remove\:"Remove a dependency from package.json" run\:"Run a script or package bin" upgrade\:"Upgrade to the latest version of bun"')
        main_commands=($main_commands)
        _alternative "$scripts" "args:bun:(($main_commands))"
        ;;
    args)
        case $line[1] in
        add)

            # ---- Command: add
            _arguments -s -C \
                '1: :->cmd1' \
                '*: :->package' \
                '--version[Show version and exit]' \
                '-V[Show version and exit]' \
                '--cwd[Change directory]:cwd' \
                '--help[Show command help]' \
                '-h[Show command help]' \
                '--registry[Change default registry (default: \$BUN_CONFIG_REGISTRY || \$npm_config_registry)]:registry' \
                '--token[Authentication token used for npm registry requests (default: \$npm_config_token)]:token' \
                '-y[Write a yarn.lock file (yarn v1)]' \
                '--yarn[Write a yarn.lock file (yarn v1)]' \
                '-g[Add a package globally]' \
                '--global[Add a package globally]' \
                '--production[Don'"'"'t install devDependencies]' \
                '--optional[Add dependency to optionalDependencies]' \
                '--development[Add dependency to devDependencies]' \
                '-d[Add dependency to devDependencies]' \
                '-p[Don'"'"'t install devDependencies]' \
                '--no-save[]' \
                '--dry-run[Don'"'"'t install anything]' \
                '--force[Always request the latest versions from the registry & reinstall all dependenices]' \
                '--lockfile[Store & load a lockfile at a specific filepath]:lockfile' \
                '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
                '--no-cache[Ignore manifest cache entirely]' \
                '--silent[Don'"'"'t output anything]' \
                '--verbose[Excessively verbose logging]' \
                '--cwd[Set a specific cwd]:cwd' \
                '--backend[Platform-specific optimizations for installing dependencies]:backend:("clonefile" "copyfile" "hardlink" "clonefile_each_dir")' \
                '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' &&
                ret=0

            case $state in
            package)
                _bun_add_param_package_completion
                ;;
            esac

            ;;
        bun)

            # ---- Command: bun
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

            ;;
        create)

            # ---- Command: create
            _arguments -s -C \
                '1: :->cmd' \
                '2: :->cmd2' \
                '*: :->args' &&
                ret=0

            case $state in
            cmd2)
                _alternative 'args:create:((next\:"Next.js app" react\:"React app"))'
                ;;

            args)
                case $line[2] in
                next)

                    # ---- Command: create next
                    _arguments -s -C \
                        '1: :->cmd' \
                        '2: :->cmd2' \
                        '3: :->file' \
                        '--version[Show version and exit]' \
                        '-V[Show version and exit]' \
                        '--cwd[Change directory]:cwd' \
                        '--help[Show command help]' \
                        '-h[Show command help]' &&
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
                        '1: :->cmd' \
                        '2: :->cmd2' \
                        '3: :->file' \
                        '--version[Show version and exit]' \
                        '-V[Show version and exit]' \
                        '--cwd[Change directory]:cwd' \
                        '--help[Show command help]' \
                        '-h[Show command help]' &&
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
            ;;
        dev)

            # ---- Command: dev
            _arguments -s -C \
                '1: :->cmd' \
                '--version[Show version and exit]' \
                '-V[Show version and exit]' \
                '--cwd[Change directory]:cwd' \
                '--help[Show command help]' \
                '-h[Show command help]' \
                '--bunfile[Use a specific .bun file (default: node_modules.bun)]:bunfile' \
                '--origin[Rewrite import paths to start from a different url. Default: http://localhost:3000]:origin' \
                '-u[Rewrite import paths to start from a different url. Default: http://localhost:3000]:u' \
                '--server-bunfile[Use a specific .bun file for SSR in bun dev (default: node_modules.server.bun)]:server-bunfile' \
                '--extension-order[defaults to: .tsx,.ts,.jsx,.js,.json]:extension-order' \
                '--jsx-runtime[JSX runtime to use. Defaults to "automatic"]:jsx-runtime:("automatic" "classic")' \
                '--main-fields[Main fields to lookup in package.json. Defaults to --platform dependent]:main-fields' \
                '--disable-react-fast-refresh[Disable React Fast Refresh]' \
                '--disable-hmr[Disable Hot Module Reloading]' \
                '--jsx-factory[Changes the function called when compiling JSX elements using the classic JSX runtime]:jsx-factory' \
                '--jsx-fragment[Changes the function called when compiling JSX fragments]:jsx-fragment' \
                '--jsx-import-source[Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: "react"]:jsx-import-source' \
                '--port[Port number]:port' &&
                ret=0

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
                _alternative 'args:cmd3:((bun create dev run upgrade))'
                ;;

            args)
                case $line[2] in
                bun)

                    # ---- Command: help bun
                    _arguments -s -C \
                        '1: :->cmd' \
                        '2: :->cmd2' \
                        '--version[Show version and exit]' \
                        '-V[Show version and exit]' \
                        '--cwd[Change directory]:cwd' \
                        '--help[Show command help]' \
                        '-h[Show command help]' \
                        '--all[]' &&
                        ret=0

                    ;;
                install)

                    # ---- Command: help install
                    _arguments -s -C \
                        '1: :->cmd1' \
                        '2: :->cmd2' \
                        '--version[Show version and exit]' \
                        '-V[Show version and exit]' \
                        '--cwd[Change directory]:cwd' \
                        '--help[Show command help]' \
                        '-g[Add a package globally]' \
                        '--global[Add a package globally]' \
                        '-h[Show command help]' \
                        '--all[]' &&
                        ret=0

                    ;;

                remove)

                    # ---- Command: help remove
                    _arguments -s -C \
                        '1: :->cmd1' \
                        '2: :->cmd2' \
                        '--version[Show version and exit]' \
                        '-V[Show version and exit]' \
                        '--cwd[Change directory]:cwd' \
                        '-g[Remove a package globally]' \
                        '--global[Remove a package globally]' \
                        '--help[Show command help]' \
                        '-h[Show command help]' \
                        '--all[]' &&
                        ret=0

                    ;;

                create)

                    # ---- Command: help create
                    _arguments -s -C \
                        '1: :->cmd' \
                        '2: :->cmd2' \
                        '3: :->cmd3' \
                        '*: :->args' &&
                        ret=0

                    case $state in
                    cmd3)
                        _alternative 'args:create:((next react))'
                        ;;

                    args)
                        case $line[3] in
                        next)

                            # ---- Command: help create next
                            _arguments -s -C \
                                '1: :->cmd' \
                                '2: :->cmd2' \
                                '3: :->cmd3' \
                                '--version[Show version and exit]' \
                                '-V[Show version and exit]' \
                                '--cwd[Change directory]:cwd' \
                                '--help[Show command help]' \
                                '-h[Show command help]' \
                                '--all[]' &&
                                ret=0

                            ;;

                        react)

                            # ---- Command: help create react
                            _arguments -s -C \
                                '1: :->cmd' \
                                '2: :->cmd2' \
                                '3: :->cmd3' \
                                '--version[Show version and exit]' \
                                '-V[Show version and exit]' \
                                '--cwd[Change directory]:cwd' \
                                '--help[Show command help]' \
                                '-h[Show command help]' \
                                '--all[]' &&
                                ret=0

                            ;;

                        esac

                        ;;

                    esac
                    ;;
                dev)

                    # ---- Command: help dev
                    _arguments -s -C \
                        '1: :->cmd' \
                        '2: :->cmd2' \
                        '--version[Show version and exit]' \
                        '-V[Show version and exit]' \
                        '--cwd[Change directory]:cwd' \
                        '--help[Show command help]' \
                        '-h[Show command help]' \
                        '--all[]' &&
                        ret=0

                    ;;

                run)
                    # ---- Command: help run
                    _arguments -s -C \
                        '1: :->cmd' \
                        '2: :->cmd2' \
                        '--version[Show version and exit]' \
                        '-V[Show version and exit]' \
                        '--cwd[Change directory]:cwd' \
                        '--help[Show command help]' \
                        '-h[Show command help]' \
                        '--all[]' &&
                        ret=0

                    ;;

                upgrade)

                    # ---- Command: help upgrade
                    _arguments -s -C \
                        '1: :->cmd' \
                        '2: :->cmd2' \
                        '--version[Show version and exit]' \
                        '-V[Show version and exit]' \
                        '--cwd[Change directory]:cwd' \
                        '--help[Show command help]' \
                        '-h[Show command help]' \
                        '--all[]' &&
                        ret=0

                    ;;

                esac

                ;;

            esac
            ;;
        install)

            # ---- Command: install
            _arguments -s -C \
                '1: :->cmd1' \
                '--version[Show version and exit]' \
                '-V[Show version and exit]' \
                '--help[Show command help]' \
                '-h[Show command help]' \
                '--registry[Change default registry (default: \$BUN_CONFIG_REGISTRY || \$npm_config_registry)]:registry' \
                '--token[Authentication token used for npm registry requests (default: \$npm_config_token)]:token' \
                '-y[Write a yarn.lock file (yarn v1)]' \
                '--yarn[Write a yarn.lock file (yarn v1)]' \
                '--production[Don'"'"'t install devDependencies]' \
                '-p[Don'"'"'t install devDependencies]' \
                '--no-save[]' \
                '--dry-run[Don'"'"'t install anything]' \
                '--force[Always request the latest versions from the registry & reinstall all dependenices]' \
                '--lockfile[Store & load a lockfile at a specific filepath]:lockfile' \
                '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
                '--no-cache[Ignore manifest cache entirely]' \
                '--silent[Don'"'"'t output anything]' \
                '--verbose[Excessively verbose logging]' \
                '--cwd[Set a specific cwd]:cwd' \
                '-g[Add a package globally]' \
                '--global[Add a package globally]' \
                '--backend[Platform-specific optimizations for installing dependencies]:backend:("clonefile" "copyfile" "hardlink" "clonefile_each_dir")' \
                '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' &&
                ret=0

            ;;

        remove)

            # ---- Command: remove
            _arguments -s -C \
                '1: :->cmd1' \
                '*: :->package' \
                '--version[Show version and exit]' \
                '-V[Show version and exit]' \
                '--help[Show command help]' \
                '-h[Show command help]' \
                '--registry[Change default registry (default: \$BUN_CONFIG_REGISTRY || \$npm_config_registry)]:registry' \
                '--token[Authentication token used for npm registry requests (default: \$npm_config_token)]:token' \
                '-y[Write a yarn.lock file (yarn v1)]' \
                '--yarn[Write a yarn.lock file (yarn v1)]' \
                '--production[Don'"'"'t install devDependencies]' \
                '-p[Don'"'"'t install devDependencies]' \
                '--no-save[]' \
                '--dry-run[Don'"'"'t install anything]' \
                '-g[Remove a package globally]' \
                '--global[Remove a package globally]' \
                '--force[Always request the latest versions from the registry & reinstall all dependenices]' \
                '--lockfile[Store & load a lockfile at a specific filepath]:lockfile' \
                '--cache-dir[Store & load cached data from a specific directory path]:cache-dir' \
                '--no-cache[Ignore manifest cache entirely]' \
                '--silent[Don'"'"'t output anything]' \
                '--verbose[Excessively verbose logging]' \
                '--backend[Platform-specific optimizations for installing dependencies]:backend:("clonefile" "copyfile" "hardlink" "clonefile_each_dir")' \
                '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' &&
                ret=0

            case $state in
            package) ;;

            esac

            ;;
        run)
            # ---- Command: run
            _arguments -s -C \
                '1: :->cmd' \
                '2: :->script' \
                '*: :->other' \
                '--version[Show version and exit]' \
                '-V[Show version and exit]' \
                '--cwd[Change directory]:cwd' \
                '--help[Show command help]' \
                '-h[Show command help]' \
                '--silent[Don'"'"'t echo the command]' &&
                ret=0

            case $state in
            script)
                curcontext="${curcontext%:*:*}:bun-grouped"
                _bun_run_param_script_completion
                ;;
            other)
                _files
                ;;
            esac

            ;;
        upgrade)

            # ---- Command: upgrade
            _arguments -s -C \
                '1: :->cmd' \
                '--version[Show version and exit]' \
                '-V[Show version and exit]' \
                '--cwd[Change directory]:cwd' \
                '--help[Show command help]' \
                '-h[Show command help]' &&
                ret=0

            ;;

        esac

        ;;

    esac

}

_bun_run_param_script_completion() {
    local -a scripts_list
    IFS=$'\n' scripts_list=($(SHELL=zsh bun getcompletes s))
    scripts="scripts:scripts:(($scripts_list))"

    IFS=$'\n' bunjs=($(SHELL=zsh bun getcompletes j))
    IFS=$'\n' bins=($(SHELL=zsh bun getcompletes b))

    if [ -n "$bunjs" ] && [ "$bunjs" != " " ]; then
        if [ -n "$bins" ] && [ "$bins" != " " ]; then
            _alternative $scripts "files:files:(($bunjs))" "bin:bin:(($bins))"
            return 1
        fi

        _alternative $scripts "args:Bun.js:(($bunjs))"
    fi

    if [ -n "$bins" ] && [ "$bins" != " " ]; then
        _alternative $scripts "args:bin:(($bins))"
        return 1
    fi
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

autoload -U compinit && compinit
compdef _bun bun
