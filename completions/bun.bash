#/usr/bin/env bash

_file_arguments() {
    local extensions="${1}"
    local reset=$(shopt -p globstar)
    shopt -s globstar

    if [[ -z "${cur_word}" ]]; then
        COMPREPLY=( $(compgen -fG -X "${extensions}" -- "${cur_word}") );
    else
        COMPREPLY=( $(compgen -f -X "${extensions}" -- "${cur_word}") );
    fi

    $reset
}

_long_short_completion() {
    local wordlist="${1}";
    local short_options="${2}"

    [[ -z "${cur_word}" || "${cur_word}" =~ ^- ]] && {
        COMPREPLY=( $(compgen -W "${wordlist}" -- "${cur_word}"));
        return;
    }
    [[ "${cur_word}" =~ ^-[A-Za_z]+ ]] && {
        COMPREPLY=( $(compgen -W "${short_options}" -- "${cur_word}"));
        return;
    }
}

# loads the scripts block in package.json
_read_scripts_in_package_json() {
    local package_json;
    local return_package_json
    local line=0;
    local working_dir="${PWD}";

    for ((; line < ${#COMP_WORDS[@]}; line+=1)); do
        [[ "${COMP_WORDS[${line}]}" == "--cwd" ]] && working_dir="${COMP_WORDS[$((line + 1))]}";
    done

    [[ -f "${working_dir}/package.json" ]] && package_json=$(<"${working_dir}/package.json");

    [[ "${package_json}" =~ "\"scripts\""[[:space:]]*":"[[:space:]]*\{(.*)\} ]] && {
        local package_json_compreply;
        local matched="${BASH_REMATCH[@]:1}";
        local scripts="${matched%%\}*}";
        scripts="${scripts//@(\"|\')/}";
        readarray -td, scripts <<<"${scripts}";
        for completion in "${scripts[@]}"; do
            package_json_compreply+=( "${completion%:*}" );
        done
        COMPREPLY+=( $(compgen -W "${package_json_compreply[*]}" -- "${cur_word}") );
    }

    # when a script is passed as an option, do not show other scripts as part of the completion anymore
    local re_prev_script="(^| )${prev}($| )";
    [[
        ( "${COMPREPLY[*]}" =~ ${re_prev_script} && -n "${COMP_WORDS[2]}" ) || \
            ( "${COMPREPLY[*]}" =~ ${re_comp_word_script} )
    ]] && {
        local re_script=$(echo ${package_json_compreply[@]} | sed 's/[^ ]*/(&)/g');
        local new_reply=$(echo "${COMPREPLY[@]}" | sed -E "s/$re_script//");
        COMPREPLY=( $(compgen -W "${new_reply}" -- "${cur_word}") );
        replaced_script="${prev}";
    }
}


_subcommand_comp_reply() {
    local cur_word="${1}"
    local sub_commands="${2}"
    local regexp_subcommand="^[dbcriauh]";
    [[ "${prev}" =~ ${regexp_subcommand} ]] && {
        COMPREPLY+=( $(compgen -W "${sub_commands}" -- "${cur_word}") );
    }
}


_bun_completions() {
    declare -A GLOBAL_OPTIONS;
    declare -A PACKAGE_OPTIONS;
    declare -A PM_OPTIONS;

    local SUBCOMMANDS="dev bun create run install add remove upgrade completions discord help init pm x test repl update link unlink build";

    GLOBAL_OPTIONS[LONG_OPTIONS]="--use --cwd --bunfile --server-bunfile --config --disable-react-fast-refresh --disable-hmr --env-file --extension-order --jsx-factory --jsx-fragment --extension-order --jsx-factory --jsx-fragment --jsx-import-source --jsx-production --jsx-runtime --main-fields --no-summary --version --platform --public-dir --tsconfig-override --define --external --help --inject --loader --origin --port --dump-environment-variables --dump-limits --disable-bun-js";
    GLOBAL_OPTIONS[SHORT_OPTIONS]="-c -v -d -e -h -i -l -u -p";

    PACKAGE_OPTIONS[ADD_OPTIONS_LONG]="--development --optional";
    PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]="-d";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_LONG]="";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]="";

    PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]="--config --yarn --production --frozen-lockfile --no-save --dry-run --force --cache-dir --no-cache --silent --verbose --global --cwd --backend --link-native-bins --help";
    PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]="-c -y -p -f -g";

    PM_OPTIONS[LONG_OPTIONS]="--config --yarn --production --frozen-lockfile --no-save --dry-run --force --cache-dir --no-cache --silent --verbose --no-progress --no-summary --no-verify --ignore-scripts --global --cwd --backend --link-native-bins --help"
    PM_OPTIONS[SHORT_OPTIONS]="-c -y -p -f -g"

    local cur_word="${COMP_WORDS[${COMP_CWORD}]}";
    local prev="${COMP_WORDS[$(( COMP_CWORD - 1 ))]}";

    case "${prev}" in
        help|--help|-h|-v|--version) return;;
        -c|--config)      _file_arguments "!*.toml" && return;;
        --bunfile)        _file_arguments "!*.bun" && return;;
        --server-bunfile) _file_arguments "!*.server.bun" && return;;
        --backend)
            case "${COMP_WORDS[1]}" in
                a|add|remove|rm|install|i)
                    COMPREPLY=( $(compgen -W "clonefile copyfile hardlink clonefile_each_dir symlink" -- "${cur_word}") );
                    ;;
            esac
            return ;;
        --cwd|--public-dir)
            COMPREPLY=( $(compgen -d -- "${cur_word}" ));
            return;;
        --jsx-runtime)
            COMPREPLY=( $(compgen -W "automatic classic" -- "${cur_word}") );
            return;;
        --target)
            COMPREPLY=( $(compgen -W "browser node bun" -- "${cur_word}") );
            return;;
        -l|--loader)
            [[ "${cur_word}" =~ (:) ]] && {
                local cut_colon_forward="${cur_word%%:*}"
                COMPREPLY=( $(compgen -W "${cut_colon_forward}:jsx ${cut_colon_forward}:js ${cut_colon_forward}:json ${cut_colon_forward}:tsx ${cut_colon_forward}:ts ${cut_colon_forward}:css" -- "${cut_colon_forward}:${cur_word##*:}") );
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
            COMPREPLY=( $(compgen -W "--force --no-install --help --no-git --verbose --no-package-json --open next react" -- "${cur_word}") );
            return;;
        upgrade)
            COMPREPLY=( $(compgen -W "--version --cwd --help -v -h") );
            return;;
        run)
            _file_arguments "!(*.@(js|ts|jsx|tsx|mjs|cjs)?($|))";
            COMPREPLY+=( $(compgen -W "--version --cwd --help --silent -v -h" -- "${cur_word}" ) );
            _read_scripts_in_package_json;
            return;;
        pm)
            _long_short_completion \
                "${PM_OPTIONS[LONG_OPTIONS]} ${PM_OPTIONS[SHORT_OPTIONS]}";
            COMPREPLY+=( $(compgen -W "bin ls cache hash hash-print hash-string" -- "${cur_word}") );
            return;;
        *)
            local replaced_script;
            _long_short_completion \
                "${GLOBAL_OPTIONS[*]}" \
                "${GLOBAL_OPTIONS[SHORT_OPTIONS]}"

            _read_scripts_in_package_json;
            _subcommand_comp_reply "${cur_word}" "${SUBCOMMANDS}";

            # determine if completion should be continued
            # when the current word is an empty string
            # the previous word is not part of the allowed completion
            # the previous word is not an argument to the last two option
            [[ -z "${cur_word}" ]] && {
                declare -A comp_reply_associative="( $(echo ${COMPREPLY[@]} | sed 's/[^ ]*/[&]=&/g') )";
                [[ -z "${comp_reply_associative[${prev}]}" ]] && {
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
