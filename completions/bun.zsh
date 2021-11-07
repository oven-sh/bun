_bun() {
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
        compadd $scripts_list && ret=0

        main_commands=('bun:"Generate a bundle" create:"Create a new project" dev:"Start a dev server" help:"Show command help" run:"Run a script or package bin" upgrade:"Upgrade to the latest version of Bun"')
        main_commands=($main_commands)
        _alternative "args:Bun:(($main_commands))"
        ;;
    args)
        case $line[1] in
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
    compadd $scripts_list && ret=0

    IFS=$'\n' bunjs=($(SHELL=zsh bun getcompletes j))
    IFS=$'\n' bins=($(SHELL=zsh bun getcompletes b))

    if [ ! -z "$bunjs" -a "$bunjs" != " " ]; then
        if [ ! -z "$bins" -a "$bins" != " " ]; then
            compadd $bunjs && ret=0
            _alternative "args:bin:(($bins))"
            return 1
        fi

        _alternative "args:Bun.js:(($bunjs))"
    fi

    if [ ! -z "$bins" -a "$bins" != " " ]; then
        _alternative "args:bin:(($bins))"
        return 1
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
