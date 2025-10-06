#! /usr/bin/env bash

_file_arguments() {
    local extensions="${1}"
    # shellcheck disable=SC2064 # current state of `globstar` is needed
    trap "$(shopt -p globstar)" RETURN
    shopt -s globstar

    # the following two `readarray` assumes that filenames has no newline characters in it,
    # otherwise they will be splitted into separate completions. the only safe way to permit
    # newlines in filenames is to use `find` with `-regexptype posix-extended` and `-print0`,
    # then `readarray -t -d '' ...`.
    if [[ -z "${cur_word}" ]]; then
        readarray -t COMPREPLY <<<"$(compgen -fG -X "${extensions}" -- "${cur_word}")";
    else
        readarray -t COMPREPLY <<<"$(compgen -f -X "${extensions}" -- "${cur_word}")";
    fi
    # if pathname expansion above produces no matching files, then
    # `compgen` output single newline character `\n`, resulting in
    # singleton `COMPREPLY` with empty string, let us mitigate this.
    [[ -z ${COMPREPLY[0]} ]] && COMPREPLY=()
}

_long_short_completion() {
    local wordlist="${1}";
    local short_options="${2}"

    [[ -z "${cur_word}" || "${cur_word}" =~ ^- ]] && {
        # shellcheck disable=SC2207 # the `wordlist` is constant and has no whitespace characters inside each word
        COMPREPLY=( $(compgen -W "${wordlist}" -- "${cur_word}") );
        return;
    }
    [[ "${cur_word}" =~ ^-[A-Za-z]+ ]] && {
        # shellcheck disable=SC2207 # idem.
        COMPREPLY=( $(compgen -W "${short_options}" -- "${cur_word}") );
        return;
    }
}

# loads the scripts block in package.json
_read_scripts_in_package_json() {
    local package_json;
    local line=0;
    local working_dir="${PWD}";

    for ((; line < ${#COMP_WORDS[@]}; line+=1)); do
        [[ "${COMP_WORDS[${line}]}" == "--cwd" ]] && working_dir="${COMP_WORDS[$((line + 1))]}";
    done

    [[ -f "${working_dir}/package.json" ]] && package_json=$(<"${working_dir}/package.json");

    [[ "${package_json}" =~ "\"scripts\""[[:space:]]*":"[[:space:]]*\{[[:space:]]*(.*)\} ]] && {
        local package_json_compreply;
        local matched="${BASH_REMATCH[1]}";
        local scripts="${matched%\}*}";
        local scripts_rem="${scripts}";
        while [[ "${scripts_rem}" =~ ^"\""(([^\"\\]|\\.)+)"\""[[:space:]]*":"[[:space:]]*"\""(([^\"\\]|\\.)*)"\""[[:space:]]*(,[[:space:]]*|$) ]]; do
            local script_name="${BASH_REMATCH[1]}";
            package_json_compreply+=( "$script_name" );
            case "$script_name" in
                ( "$cur_word"* )
                    COMPREPLY+=( "$script_name" );
                ;;
            esac
            scripts_rem="${scripts_rem:${#BASH_REMATCH[0]}}";
        done
    }

    # when a script is passed as an option, do not show other scripts as part of the completion anymore
    local re_prev_script="(^| )${prev}($| )";
    [[ ( "${COMPREPLY[*]}" =~ ${re_prev_script} && -n "${COMP_WORDS[2]}" ) ]] && {
        declare -a new_reply;
        for comp in "${COMPREPLY[@]}"; do
            case " ${package_json_compreply[@]} " in
                ( *[[:space:]]"$comp"[[:space:]]* )
                    continue;
                ;;
                ( * )
                    case "$comp" in
                        ( "$cur_word"* )
                            new_reply+=( "$comp" );
                        ;;
                    esac
                ;;
            esac
        done
        COMPREPLY=();
        for comp in "${new_reply[@]}"; do
            COMPREPLY+=( "$comp" );
        done
        replaced_script="${prev}";
    }
}


_subcommand_comp_reply() {
    local cur_word="${1}"
    local sub_commands="${2}"
    local regexp_subcommand="^[dbcriauh]";
    [[ "${prev}" =~ ${regexp_subcommand} ]] && {
        # shellcheck disable=SC2207 # `sub_commands` is constant and has no whispace characters in each subcommand
        COMPREPLY+=( $(compgen -W "${sub_commands}" -- "${cur_word}") );
    }
}


_bun_completions() {
    declare -A GLOBAL_OPTIONS;
    declare -A PACKAGE_OPTIONS;
    declare -A PM_OPTIONS;

    local SUBCOMMANDS="dev bun create run install add remove upgrade completions discord help init pm x test repl update outdated link unlink build";

    GLOBAL_OPTIONS[LONG_OPTIONS]="--use --cwd --bunfile --server-bunfile --config --disable-react-fast-refresh --disable-hmr --env-file --extension-order --jsx-factory --jsx-fragment --extension-order --jsx-factory --jsx-fragment --jsx-import-source --jsx-production --jsx-runtime --main-fields --no-summary --version --platform --public-dir --tsconfig-override --define --external --help --inject --loader --origin --port --dump-environment-variables --dump-limits --disable-bun-js";
    GLOBAL_OPTIONS[SHORT_OPTIONS]="-c -v -d -e -h -i -l -u -p";

    PACKAGE_OPTIONS[ADD_OPTIONS_LONG]="--development --optional --peer";
    PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]="-d";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_LONG]="";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]="";

    PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]="--config --yarn --production --frozen-lockfile --no-save --dry-run --force --cache-dir --no-cache --silent --verbose --global --cwd --backend --link-native-bins --help";
    PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]="-c -y -p -f -g";

    PM_OPTIONS[LONG_OPTIONS]="--config --yarn --production --frozen-lockfile --no-save --dry-run --force --cache-dir --no-cache --silent --verbose --no-progress --no-summary --no-verify --ignore-scripts --global --cwd --backend --link-native-bins --help"
    PM_OPTIONS[SHORT_OPTIONS]="-c -y -p -f -g"

    cur_word="${COMP_WORDS[${COMP_CWORD}]}";
    prev="${COMP_WORDS[$(( COMP_CWORD - 1 ))]}";

    case "${prev}" in
        help|--help|-h|-v|--version) return;;
        -c|--config)      _file_arguments "!*.toml" && return;;
        --bunfile)        _file_arguments "!*.bun" && return;;
        --server-bunfile) _file_arguments "!*.server.bun" && return;;
        --backend)
            case "${COMP_WORDS[1]}" in
                a|add|remove|rm|install|i)
                    # shellcheck disable=SC2207 # the literal space separated string is used, each element has no whitspace characrters inside
                    COMPREPLY=( $(compgen -W "clonefile copyfile hardlink clonefile_each_dir symlink" -- "${cur_word}") );
                ;;
            esac
            return;;
        --cwd|--public-dir)
            readarray -t COMPREPLY <<<"$(compgen -d -- "${cur_word}")";
            return;;
        --jsx-runtime)
            # shellcheck disable=SC2207 # see above
            COMPREPLY=( $(compgen -W "automatic classic" -- "${cur_word}") );
            return;;
        --target)
            # shellcheck disable=SC2207 # idem.
            COMPREPLY=( $(compgen -W "browser node bun" -- "${cur_word}") );
            return;;
        -l|--loader)
            [[ "${cur_word}" =~ (:) ]] && {
                local cut_colon_forward="${cur_word%%:*}"
                readarray -t COMPREPLY <<<"$(compgen -W "${cut_colon_forward}:jsx ${cut_colon_forward}:js ${cut_colon_forward}:json ${cut_colon_forward}:tsx ${cut_colon_forward}:ts ${cut_colon_forward}:css" -- "${cut_colon_forward}:${cur_word##*:}")";
            }
            return;;
    esac

    case "${COMP_WORDS[1]}" in
        help|completions|--help|-h|-v|--version) return;;
        add|a)
            _long_short_completion \
                "${PACKAGE_OPTIONS[ADD_OPTIONS_LONG]} ${PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}"
            return;;
        remove|rm|i|install|link|unlink)
            _long_short_completion \
                "${PACKAGE_OPTIONS[REMOVE_OPTIONS_LONG]} ${PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}";
            return;;
        create|c)
            # shellcheck disable=SC2207 # the literal string of space separated flags is used, there are no flags containing whitespace character
            COMPREPLY=( $(compgen -W "--force --no-install --help --no-git --verbose --no-package-json --open next react" -- "${cur_word}") );
            return;;
        upgrade)
            # shellcheck disable=SC2207 # see above
            COMPREPLY=( $(compgen -W "--version --cwd --help -v -h" -- "${cur_word}") );
            return;;
        run)
            _file_arguments "!(*.@(js|ts|jsx|tsx|mjs|cjs)?($|))";
            # shellcheck disable=SC2207 # idem.
            COMPREPLY+=( $(compgen -W "--version --cwd --help --silent -v -h" -- "${cur_word}" ) );
            _read_scripts_in_package_json;
            return;;
        pm)
            _long_short_completion \
                "${PM_OPTIONS[LONG_OPTIONS]} ${PM_OPTIONS[SHORT_OPTIONS]}";
            # shellcheck disable=SC2207 # the literal space-separated string of subcommands is used, no subcommand containing the space character exists
            COMPREPLY+=( $(compgen -W "bin ls cache hash hash-print hash-string" -- "${cur_word}") );
            return;;
        *)
            declare -g replaced_script;
            _long_short_completion \
                "${GLOBAL_OPTIONS[*]}" \
                "${GLOBAL_OPTIONS[SHORT_OPTIONS]}"

            _read_scripts_in_package_json;
            _subcommand_comp_reply "${cur_word}" "${SUBCOMMANDS}";

            # determine if completion should be continued
            # when the current word is an empty string
            # the previous word is not part of the allowed completion
            # the previous word is not an argument to the last two options
            [[ -z "${cur_word}" ]] && {
                declare -A comp_reply_associative
                    for comp in "${COMPREPLY[@]}"; do
                        comp_reply_associative["$comp"]="$comp"
                    done
                [[ -z "${comp_reply_associative["${prev}"]}" ]] && {
                    local re_prev_prev="(^| )${COMP_WORDS[(( COMP_CWORD - 2 ))]}($| )";
                    local global_option_with_extra_args="--bunfile --server-bunfile --config --port --cwd --public-dir --jsx-runtime --platform --loader";
                    [[
                        ( -n "${replaced_script}" && "${replaced_script}" == "${prev}" ) || \
                            ( "${global_option_with_extra_args}" =~ ${re_prev_prev} )
                    ]] && return;
                    unset COMPREPLY;
                }
            }
            return;;
    esac
}

complete -F _bun_completions bun
