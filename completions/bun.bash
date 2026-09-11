#/usr/bin/env bash

shopt -s extglob

_file_arguments() {
    local extensions="${1}"
    local files=()

    if [[ -n "${extensions}" ]]; then
        files=( $(compgen -f -X "${extensions}" -- "${cur_word}") )
    else
        files=( $(compgen -f -- "${cur_word}") )
    fi

    local dirs=( $(compgen -d -S / -- "${cur_word}") )
    COMPREPLY+=( "${files[@]}" "${dirs[@]}" )
}

_long_short_completion() {
    local wordlist="${1}"
    local short_options="${2}"

    if [[ -z "${cur_word}" || "${cur_word}" == -* ]]; then
        COMPREPLY+=( $(compgen -W "${wordlist}" -- "${cur_word}") )
    fi
}

_read_scripts_in_package_json() {
    local pkg_file="package.json"
    [[ -f "${pkg_file}" && -r "${pkg_file}" ]] || return 0

    local in_scripts=0 line_content script_names=()
    while IFS= read -r line_content || [[ -n "${line_content}" ]]; do
        if (( ! in_scripts )); then
            if [[ "${line_content}" =~ \"scripts\"[[:space:]]*:[[:space:]]*\{? ]]; then
                in_scripts=1
            fi
        else
            if [[ "${line_content}" =~ \}[[:space:]]*,? ]]; then
                break
            fi
            if [[ "${line_content}" =~ \"([^\"\\]+)\"[[:space:]]*: ]]; then
                script_names+=( "${BASH_REMATCH[1]}" )
            fi
        fi
    done < "${pkg_file}"

    if (( ${#script_names[@]} > 0 )); then
        COMPREPLY+=( $(compgen -W "${script_names[*]}" -- "${cur_word}") )
    fi
}

_bun_completions_inner() {
    local SUBCOMMANDS="dev bun create run install add remove upgrade completions discord help init pm x test repl update audit dedupe prune outdated link unlink build"

    local GLOBAL_OPTIONS_LONG="--use --cwd --bunfile --server-bunfile --config --disable-react-fast-refresh --disable-hmr --env-file --extension-order --jsx-factory --jsx-fragment --jsx-import-source --jsx-production --jsx-runtime --main-fields --no-summary --version --platform --public-dir --tsconfig-override --define --external --help --inject --loader --origin --port --dump-environment-variables --dump-limits --disable-bun-js"
    local GLOBAL_OPTIONS_SHORT="-c -v -d -e -h -i -l -u -p"

    local ADD_OPTIONS_LONG="--development --optional --peer --catalog --filter"
    local ADD_OPTIONS_SHORT="-d -F"
    local REMOVE_OPTIONS_LONG="--filter"
    local REMOVE_OPTIONS_SHORT="-F"
    local UPDATE_OPTIONS_LONG="--latest --interactive --recursive --filter --dev --development --prod --no-optional --exact"
    local UPDATE_OPTIONS_SHORT="-L -i -r -F -d -D -P -E"

    local SHARED_OPTIONS_LONG="--config --yarn --production --frozen-lockfile --no-save --dry-run --force --cache-dir --no-cache --silent --verbose --global --cwd --backend --link-native-bins --help"
    local SHARED_OPTIONS_SHORT="-c -y -p -f -g"

    local DEDUPE_OPTIONS_LONG="--check"
    local PRUNE_OPTIONS_LONG="--production --prod --omit --filter --dry-run --os --cpu --linker --silent --cwd --help"
    local PRUNE_OPTIONS_SHORT="-p -P -F -h"
    local AUDIT_OPTIONS_LONG="--json --audit-level --ignore --prod --production --omit --dry-run --latest --cwd --help"
    local AUDIT_OPTIONS_SHORT="-L"

    local PM_OPTIONS_LONG="--config --yarn --production --frozen-lockfile --no-save --dry-run --force --cache-dir --no-cache --silent --verbose --no-progress --no-summary --no-verify --ignore-scripts --global --cwd --backend --link-native-bins --json --help"
    local PM_OPTIONS_SHORT="-c -y -p -f -g"

    local cur_word="${COMP_WORDS[${COMP_CWORD}]}"
    local prev="${COMP_WORDS[$(( COMP_CWORD - 1 ))]}"

    case "${prev}" in
        help|--help|-h|-v|--version) return ;;
        -c|--config)      _file_arguments "!*.toml" && return ;;
        --bunfile)        _file_arguments "!*.bun" && return ;;
        --server-bunfile) _file_arguments "!*.server.bun" && return ;;
        --backend)
            COMPREPLY=( $(compgen -W "clonefile copyfile hardlink clonefile_each_dir symlink" -- "${cur_word}") )
            return ;;
        --omit)
            COMPREPLY=( $(compgen -W "dev optional peer" -- "${cur_word}") )
            return ;;
        --linker)
            COMPREPLY=( $(compgen -W "isolated hoisted" -- "${cur_word}") )
            return ;;
        --cwd|--public-dir)
            COMPREPLY=( $(compgen -d -S / -- "${cur_word}") )
            return ;;
        --jsx-runtime)
            COMPREPLY=( $(compgen -W "automatic classic" -- "${cur_word}") )
            return ;;
        --target)
            COMPREPLY=( $(compgen -W "browser node bun" -- "${cur_word}") )
            return ;;
        -l|--loader)
            if [[ "${cur_word}" == *:* ]]; then
                local prefix="${cur_word%%:*}"
                COMPREPLY=( $(compgen -W "${prefix}:jsx ${prefix}:js ${prefix}:json ${prefix}:tsx ${prefix}:ts ${prefix}:css" -- "${cur_word}") )
            fi
            return ;;
    esac

    local subcommand=""
    local skip=0
    local i
    for (( i=1; i < COMP_CWORD; i++ )); do
        if (( skip > 0 )); then
            (( skip-- ))
            continue
        fi

        local w="${COMP_WORDS[i]}"
        case "${w}" in
            --cwd|--bunfile|--server-bunfile|-c|--config|--env-file|--port|-p|--loader|-l|--target|--origin|--public-dir|--backend|--filter|-F|--jsx-runtime|--omit|--linker)
                if [[ "${COMP_WORDS[i+1]}" == "=" ]]; then
                    skip=2
                else
                    skip=1
                fi
                continue
                ;;
            -*)
                continue
                ;;
            *)
                subcommand="${w}"
                break
                ;;
        esac
    done

    case "${subcommand}" in
        help|completions) return ;;
        add|a)
            _long_short_completion \
                "${ADD_OPTIONS_LONG} ${ADD_OPTIONS_SHORT} ${SHARED_OPTIONS_LONG} ${SHARED_OPTIONS_SHORT}" \
                "${ADD_OPTIONS_SHORT} ${SHARED_OPTIONS_SHORT}"
            return ;;
        remove|rm|i|install)
            _long_short_completion \
                "${REMOVE_OPTIONS_LONG} ${REMOVE_OPTIONS_SHORT} ${SHARED_OPTIONS_LONG} ${SHARED_OPTIONS_SHORT}" \
                "${REMOVE_OPTIONS_SHORT} ${SHARED_OPTIONS_SHORT}"
            return ;;
        update|up)
            _long_short_completion \
                "${UPDATE_OPTIONS_LONG} ${UPDATE_OPTIONS_SHORT} ${SHARED_OPTIONS_LONG} ${SHARED_OPTIONS_SHORT}" \
                "${UPDATE_OPTIONS_SHORT} ${SHARED_OPTIONS_SHORT}"
            return ;;
        link|unlink)
            _long_short_completion \
                "${SHARED_OPTIONS_LONG} ${SHARED_OPTIONS_SHORT}" \
                "${SHARED_OPTIONS_SHORT}"
            return ;;
        dedupe)
            _long_short_completion \
                "${DEDUPE_OPTIONS_LONG} ${SHARED_OPTIONS_LONG} ${SHARED_OPTIONS_SHORT}" \
                "${SHARED_OPTIONS_SHORT}"
            return ;;
        prune)
            _long_short_completion \
                "${PRUNE_OPTIONS_LONG} ${PRUNE_OPTIONS_SHORT}" \
                "${PRUNE_OPTIONS_SHORT}"
            return ;;
        audit)
            COMPREPLY=( $(compgen -W "fix ${AUDIT_OPTIONS_LONG} ${AUDIT_OPTIONS_SHORT}" -- "${cur_word}") )
            return ;;
        create|c)
            COMPREPLY=( $(compgen -W "--force --no-install --help --no-git --verbose --no-package-json --open next react" -- "${cur_word}") )
            return ;;
        upgrade)
            COMPREPLY=( $(compgen -W "--version --cwd --help -v -h" -- "${cur_word}") )
            return ;;
        repl)
            COMPREPLY=( $(compgen -W "--help -h --eval -e --print -p --preload -r --smol --config -c --cwd --env-file --no-env-file" -- "${cur_word}") )
            return ;;
        run)
            _read_scripts_in_package_json
            _file_arguments "!*.@(js|ts|jsx|tsx|mjs|cjs)"
            _long_short_completion "--version --cwd --help --silent -v -h" "-v -h"
            return ;;
        test)
            _file_arguments "!*.@(js|ts|jsx|tsx|mjs|cjs)"
            _long_short_completion "--bail --coverage --watch --timeout --todo --only --rerun-each --filter --help -b -t -h" "-b -t -h"
            return ;;
        build|b)
            _file_arguments "!*.@(js|ts|jsx|tsx|mjs|cjs|html)"
            _long_short_completion "--outdir --outfile --target --format --minify --sourcemap --entry-naming --public-path --compile --bytecode --help -h" "-h"
            return ;;
        pm)
            _long_short_completion "${PM_OPTIONS_LONG} ${PM_OPTIONS_SHORT}"
            COMPREPLY=( $(compgen -W "bin ls licenses cache hash hash-print hash-string" -- "${cur_word}") )
            return ;;
        "")
            COMPREPLY=( $(compgen -W "${SUBCOMMANDS}" -- "${cur_word}") )
            _long_short_completion "${GLOBAL_OPTIONS_LONG}" "${GLOBAL_OPTIONS_SHORT}"
            _read_scripts_in_package_json
            return ;;
        *)
            _file_arguments
            return ;;
    esac
}

_bun_completions() {
    local working_dir="${PWD}" line
    for (( line=0; line < ${#COMP_WORDS[@]}; line++ )); do
        if [[ "${COMP_WORDS[line]}" == "--cwd" ]]; then
            if [[ "${COMP_WORDS[line+1]}" == "=" && -n "${COMP_WORDS[line+2]}" ]]; then
                working_dir="${COMP_WORDS[line+2]}"
            elif [[ -n "${COMP_WORDS[line+1]}" ]]; then
                working_dir="${COMP_WORDS[line+1]}"
            fi
        elif [[ "${COMP_WORDS[line]}" == --cwd=* ]]; then
            working_dir="${COMP_WORDS[line]#--cwd=}"
        fi
    done

    working_dir="${working_dir%\"}"
    working_dir="${working_dir#\"}"
    working_dir="${working_dir%\'}"
    working_dir="${working_dir#\'}"
    working_dir="${working_dir/#\~/$HOME}"

    local orig_pwd="${PWD}"
    local switched=0
    if [[ -n "${working_dir}" && -d "${working_dir}" && "${working_dir}" != "${PWD}" ]]; then
        if builtin cd "${working_dir}" 2>/dev/null; then
            switched=1
        fi
    fi

    _bun_completions_inner

    if (( switched )); then
        builtin cd "${orig_pwd}" 2>/dev/null
    fi

    # Suppress trailing space only when completing a directory
    if [[ ${#COMPREPLY[@]} -eq 1 && "${COMPREPLY[0]}" == */ ]]; then
        compopt -o nospace 2>/dev/null
    fi
}

complete -F _bun_completions bun bunx
