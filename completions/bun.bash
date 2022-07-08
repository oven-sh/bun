#/usr/bin/env bash


file_arguments() {

    local cur_word="${1}";
    local extension="${2}";

    [[ -z "${cur_word}" ]] && {
        COMPREPLY=( $(compgen -G "*.${extension}" -- "${cur_word}") );
    }

    COMPREPLY=( $(compgen -fG "${cur_word}*.${extension}" -- "${cur_word}") );
}

long_short_completion() {

    local cur_word="${1}";
    local wordlist="${2}";
    local short_options="${3}"

    [[ -z "${cur_word}" || "${cur_word}" =~ ^- ]] && {
        COMPREPLY=( $(compgen -W "${wordlist}" -- "${cur_word}"));
        return;
    }

    [[ "${cur_word}" =~ ^-[A-Za_z]+ ]] && {
        COMPREPLY=( $(compgen -W "${short_options}" -- "${cur_word}"));
        return;
    }
}

read_scripts_in_package_json() {

    local package_json;
    local line=0;
    local working_dir="${PWD}";

    for ((; line < ${#COMP_WORDS[@]}; line+=1)); do
        [[ "${COMP_WORDS[${line}]}" == "--cwd" ]] && working_dir="${COMP_WORDS[$((line + 1))]}";
    done

    [[ -f "${working_dir}/package.json" ]] && package_json=$(<${working_dir}/package.json);

    [[ "${package_json}" =~ "\"scripts\""[[:space:]]*":"[[:space:]]*\{(.*)\} ]] && {

        local package_json_compreply;
        local matched="${BASH_REMATCH[@]:1}";
        local scripts="${matched%%\}*}";

        shopt -s extglob;
        scripts="${scripts//@(\"|\')/}";
        shopt -u extglob;

        readarray -td, scripts <<<"${scripts}";

        for completion in "${scripts[@]}"; do
            package_json_compreply+=( "${completion%:*}" );
        done

        COMPREPLY+=( $(compgen -W "${package_json_compreply[*]}" -- "${cur_word}") );
    }
}

_bun_completions() {

    declare -A GLOBAL_OPTIONS;
    declare -A PACKAGE_OPTIONS;


    SUBCOMMANDS="dev bun create run install add remove upgrade completions discord help";

    GLOBAL_OPTIONS[LONG_OPTIONS]="--use --cwd --bunfile --server-bunfile --config --disable-react-fast-refresh --disable-hmr --extension-order --jsx-factory --jsx-fragment --extension-order --jsx-factory --jsx-fragment --jsx-import-source --jsx-production --jsx-runtime --main-fields --no-summary --version --platform --public-dir --tsconfig-override --define --external --help --inject --loader --origin --port --dump-environment-variables --dump-limits --disable-bun-js";
    GLOBAL_OPTIONS[SHORT_OPTIONS]="-c -v -d -e -h -i -l -u -p";


    PACKAGE_OPTIONS[ADD_OPTIONS_LONG]="--development --optional";
    PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]="-d";

    PACKAGE_OPTIONS[REMOVE_OPTIONS_LONG]="";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]="";

    PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]="--config --yarn --production --no-save --dry-run --lockfile --force --cache-dir --no-cache --silent --verbose --global --cwd --backend --link-native-bins --help";
    PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]="-c -y -p -f -g";

    local cur_word="${COMP_WORDS[${COMP_CWORD}]}";
    local prev="${COMP_WORDS[$(( COMP_CWORD - 1 ))]}";

    case "${prev}" in
        help|--help|-h|-v|--version) return;;
        -c|--config)      file_arguments "${cur_word}" "toml"       && return;;
        --bunfile)        file_arguments "${cur_word}" "bun"        && return;;
        --server-bunfile) file_arguments "${cur_word}" "server.bun" && return;;
        --backend)

            case "${COMP_WORDS[1]}" in
                a|add|remove|rm|install|i)
                    COMPREPLY=( $(compgen -W "clonefile copyfile hardlink clonefile_each_dir" -- "${cur_word}") );
                    ;;
                *) : ;;
            esac

            return ;;

        --cwd|--public-dir)
            COMPREPLY=( $(compgen -d -- "${cur_word}" ));
            return;;
        --jsx-runtime)
            COMPREPLY=( $(compgen -W "automatic classic" -- "${cur_word}") );
            return;;
        --platform)
            COMPREPLY=( $(compgen -W "browser node" -- "${cur_word}") );
            return;;
        -l|--loader)
            [[ "${cur_word}" =~ (:) ]] && {
                local cut_colon_forward="${cur_word%%:*}"
                COMPREPLY=( $(compgen -W "${cut_colon_forward}:jsx ${cut_colon_forward}:js ${cut_colon_forward}:json ${cut_colon_forward}:tsx ${cut_colon_forward}:ts \
 ${cut_colon_forward}:css" -- "${cut_colon_forward}:${cur_word##*:}") );
            }
            return;;
    esac

    case "${COMP_WORDS[1]}" in
        help|--help|-h|-v|--version) return;;
        add|a)
            long_short_completion \
                "${cur_word}" \
                "${PACKAGE_OPTIONS[ADD_OPTIONS_LONG]} ${PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}"
            return;;
        remove|rm|i|install)
            long_short_completion \
                "${cur_word}" \
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
            COMPREPLY=( $(compgen -W "--version --cwd --help --silent -v -h" -- "${cur_word}" ) );
            read_scripts_in_package_json;
            return;;
        *)
            long_short_completion \
                "${cur_word}" \
                "${GLOBAL_OPTIONS[*]}" \
                "${GLOBAL_OPTIONS[SHORT_OPTIONS]}"

            read_scripts_in_package_json;

            local regexp_subcommand="^[dbcriauh]";

            [[ "${prev}" =~ ${regexp_subcommand} ]] && {
                COMPREPLY+=( $(compgen -W "${SUBCOMMANDS}" -- "${cur_word}") );
            }
            [[ -z "${cur_word}" ]] && {
                declare -A comp_reply_associative="( $(echo ${COMPREPLY[@]} | sed 's/[^ ]*/[&]=&/g') )";
                [[ -z "${comp_reply_associative[${prev}]}" ]] && unset COMPREPLY;
            }
            return;;
    esac

}

complete -F _bun_completions bun
