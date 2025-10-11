#!/usr/bin/env bash

_escape_bash_specials() {
    local word="${1}";
    local escape_all="${2}";

    local re_exp;
    local re_sed;

    if (( escape_all )); then
        # escape all bash specials: ]~$"'`><()[{}=|*?;&#\
        re_exp='[]~$\"'"\'"'\`><\()[{\}=|*?;&#\\]';
        re_sed='[]~$"'\''`><()[{}=|*?;&#\]';
    else
        # escape all bash specials _except_ " (quote) and \ (backslash)
        # since they are already escaped in package.json: ]~$'`><()[{}=|*?;&#
        re_exp='[]~$'"\'"'\`><\()[{\}=|*?;&#]';
        re_sed='[]~$'\''`><()[{}=|*?;&#]';
    fi

    local has_patsub=0;
    shopt -s patsub_replacement 2>/dev/null && {
        # shellcheck disable=SC2064 # current state of `patsub_replacement` is needed
        trap "$(shopt -p patsub_replacement)" RETURN;
        has_patsub=1;
    }

    if (( has_patsub )); then
        echo "${word//${re_exp}/\\&}";
    else
        sed "s/${re_sed}/\\\\&/g" <<<"${word}";
    fi
}


_is_exist_and_gnu() {
    local cmd="${1}";
    local version_string;
    version_string="$(
        command -v "$cmd" >/dev/null 2>&1   && \
        "$cmd" --version 2>/dev/null | head -1;
    )";
    [[ "$version_string" == *GNU* ]] && return 0 || return 1;
}


_file_arguments() {
    local extensions="${1}";
    local cur_word="${2}";

    local -a candidates;
    if _is_exist_and_gnu find && _is_exist_and_gnu sed
    then
        readarray -t -d '' candidates < <(
            find . -regextype posix-extended -maxdepth 1 \
                -xtype f -regex "${extensions}" -name "${cur_word}*" -printf '%f\0' |
            sed -z "s/\n/\$'n'/g"
    )
    else
        # the following two `readarray` assumes that filenames has
        # no newline characters in it, otherwise they will be splitted
        # into separate completions.
        if [[ -z "${cur_word}" ]]; then
            readarray -t candidates <<<"$(compgen -f)";
        else
            readarray -t candidates <<<"$(compgen -f -- "${cur_word}")";
        fi
        # if pathname expansion above produces no matching files, then
        # `compgen` output single newline character `\n`, resulting in
        # singleton `candidates` with empty string, let us mitigate this.
        [[ -z ${candidates[0]} ]] && candidates=()
    fi

    for cnd in "${candidates[@]}"; do
        [[ -f "${cnd}" && "${cnd}" =~ ${extensions} ]] && \
            COMPREPLY+=( "$(_escape_bash_specials "${cnd##*/}" 1)" );
    done
}

_long_short_completion() {
    local long_opts="${1}";
    local short_opts="${2}";
    local cur_word="${3}";

    if [[ -z "${cur_word}" ]]; then
        # shellcheck disable=SC2207 # the `wordlist` is constant and has no whitespace characters inside each word
        COMPREPLY+=( $(compgen -W "${long_opts} ${short_opts}") );
    elif [[ "${cur_word}" == --* ]]; then
        # shellcheck disable=SC2207 # idem.
        COMPREPLY+=( $(compgen -W "${long_opts}" -- "${cur_word}") );
    elif [[ "${cur_word}" == -* ]]; then
        # shellcheck disable=SC2207 # idem.
        COMPREPLY+=( $(compgen -W "${long_opts} ${short_opts}" -- "${cur_word}") );
        return;
    fi
}


# loads the scripts block in package.json
_read_scripts_in_package_json() {
    local cur_word="${1}";
    local pre_word="${2}";

    local package_json;
    local working_dir="${PWD}";
    local line=0;

    for ((; line < ${#COMP_WORDS[@]}; line+=1)); do
        [[ "${COMP_WORDS[${line}]}" == "--cwd" ]] && working_dir="${COMP_WORDS[((line + 1))]}";
    done

    [[ -f "${working_dir}/package.json" ]] && package_json=$(<"${working_dir}/package.json");

    [[ "${package_json}" =~ '"scripts"'[[:space:]]*':'[[:space:]]*\{[[:space:]]*(.*)\} ]] && {
        local matched="${BASH_REMATCH[1]}";
        local scripts="${matched%\}*}";

        local scripts_rem="${scripts}";
        local -a script_candidates;

        while [[ "${scripts_rem}" =~ ^'"'(([^\"\\]|\\.)+)'"'[[:space:]]*":"[[:space:]]*'"'(([^\"\\]|\\.)*)'"'[[:space:]]*(,[[:space:]]*|$) ]]; do
            local script;
            script="$(_escape_bash_specials "${BASH_REMATCH[1]}" 0)";

            # when a script is passed as an option, do not show other scripts as part of the completion anymore
            [[ "${script}" == "${pre_word}" ]] && return 1;

            script_candidates+=( "${script}" );
            scripts_rem="${scripts_rem:${#BASH_REMATCH[0]}}";
        done
    }

    for script in "${script_candidates[@]}"; do
        [[ "${script}" == "${cur_word}"* ]] && COMPREPLY+=( "${script}" );
    done
    return 0;
}


_subcommand_comp_reply() {
    local sub_commands="${1}";
    local cur_word="${2}";
    local pre_word="${3}";

    local regexp_subcommand="^[dbcriauh]";

    [[ "${pre_word}" =~ ${regexp_subcommand} ]] && {
        if [[ -z "${cur_word}" ]]; then
            # shellcheck disable=SC2207 # `sub_commands` is constant and has no whitespace characters in each subcommand
            COMPREPLY+=( $(compgen -W "${sub_commands}") );
        else
            # shellcheck disable=SC2207 # idem.
            COMPREPLY+=( $(compgen -W "${sub_commands}" -- "${cur_word}") );
        fi
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

    local cur_word="${COMP_WORDS[${COMP_CWORD}]}";
    local pre_word="${COMP_WORDS[$(( COMP_CWORD - 1 ))]}";

    case "${pre_word}" in
        help|--help|-h|-v|--version) return;;
        -c|--config)      _file_arguments '.+\.toml$' "${cur_word}" && return;;
        --bunfile)        _file_arguments '.+\.bun$' "${cur_word}" && return;;
        --server-bunfile) _file_arguments '.+\.server\.bun$' "${cur_word}" && return;;
        --backend)
            case "${COMP_WORDS[1]}" in
                a|add|remove|rm|install|i)
                    # shellcheck disable=SC2207 # the literal space separated string is used, each element has no whitespace characters inside
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
                local cut_colon_forward="${cur_word%%:*}";
                readarray -t COMPREPLY <<<"$(compgen -W "${cut_colon_forward}:jsx ${cut_colon_forward}:js ${cut_colon_forward}:json ${cut_colon_forward}:tsx ${cut_colon_forward}:ts ${cut_colon_forward}:css" -- "${cut_colon_forward}:${cur_word##*:}")";
            }
            return;;
    esac

    case "${COMP_WORDS[1]}" in
        help|completions|--help|-h|-v|--version) return;;
        add|a)
            _long_short_completion \
                "${PACKAGE_OPTIONS[ADD_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]}" \
                "${PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${cur_word}";
            return;;
        remove|rm|i|install|link|unlink)
            _long_short_completion \
                "${PACKAGE_OPTIONS[REMOVE_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]}" \
                "${PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${cur_word}";
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
            _file_arguments '.+\.(js|ts|jsx|tsx|mjs|cjs)$' "${cur_word}";
            # shellcheck disable=SC2207 # idem.
            COMPREPLY+=( $(compgen -W "--version --cwd --help --silent -v -h" -- "${cur_word}" ) );
            _read_scripts_in_package_json "${cur_word}" "${pre_word}";
            return;;
        pm)
            _long_short_completion \
                "${PM_OPTIONS[LONG_OPTIONS]}" \
                "${PM_OPTIONS[SHORT_OPTIONS]}" \
                "${cur_word}";
            # shellcheck disable=SC2207 # the literal space-separated string of subcommands is used, no subcommand containing the space character exists
            COMPREPLY+=( $(compgen -W "bin ls cache hash hash-print hash-string" -- "${cur_word}") );
            return;;
        *)
            _long_short_completion \
                "${GLOBAL_OPTIONS[LONG_OPTIONS]}" \
                "${GLOBAL_OPTIONS[SHORT_OPTIONS]}" \
                "${cur_word}";
            local pre_is_script=0;
            _read_scripts_in_package_json "${cur_word}" "${pre_word}" || pre_is_script=1;
            _subcommand_comp_reply "${SUBCOMMANDS}" "${cur_word}" "${pre_word}";

            # determine if completion should be continued when
            # the current word is an empty string and either:
            # a. the previous word is part of the allowed completion
            # b. the previous word is an argument to second-to-previous option
            # c. the previouos word is the script name
            # FIXME: Is c. a valid case here?
            [[ -z "${cur_word}" ]] && {
                for comp in "${COMPREPLY[@]}"; do
                    # if `pre_word` is script name, then scripts are filtred out from `COMPREPLY`, so
                    # the `_pre_is_script` is needed to detect that previous word is the script name
                    [[ "${pre_word}" == "${comp}" ]] && return; # a.
                done

                local pre_pre_word="${COMP_WORDS[(( COMP_CWORD - 2 ))]}";
                local global_options_with_arg="--bunfile --server-bunfile --config --port --cwd --public-dir --jsx-runtime --platform --loader";

                for opt in "${global_options_with_arg[@]}"; do
                    [[ "${pre_pre_word}" == "${opt}" ]] && return; # b.
                done

                (( pre_is_script )) && return; # c.

                unset COMPREPLY;
            }
            return;;
    esac
}


complete -F _bun_completions bun
