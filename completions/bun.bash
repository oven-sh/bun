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

    local SUBCOMMANDS="dev bun create run install add remove upgrade completions discord help init pm x test repl update outdated link unlink build audit info exec publish patch patch-commit";

    GLOBAL_OPTIONS[LONG_OPTIONS]="--use --cwd --bunfile --server-bunfile --config --disable-react-fast-refresh --disable-hmr --env-file --extension-order --jsx-factory --jsx-fragment --jsx-import-source --jsx-production --jsx-runtime --main-fields --no-summary --version --platform --public-dir --tsconfig-override --define --external --help --inject --loader --origin --port --dump-environment-variables --dump-limits --disable-bun-js --minify --minify-syntax --minify-whitespace --minify-identifiers --sourcemap --target --splitting --compile --format --inspect --inspect-wait --inspect-brk --hot --watch --no-install --install --prefer-offline --prefer-latest --if-present --no-clear-screen --smol --require --import --fetch-preconnect --max-http-header-size --dns-result-order --expose-gc --no-deprecation --throw-deprecation --title --zero-fill-buffers --redis-preconnect --no-addons --unhandled-rejections --silent --elide-lines --revision --filter --bun --shell";
    GLOBAL_OPTIONS[SHORT_OPTIONS]="-c -v -d -e -h -i -l -u -p -r -F -b";

    PACKAGE_OPTIONS[ADD_OPTIONS_LONG]="--development --optional --peer --dev --analyze --only-missing --exact";
    PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]="-d";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_LONG]="";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]="";

    PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]="--config --yarn --production --frozen-lockfile --no-save --save --dry-run --force --cache-dir --no-cache --silent --verbose --no-progress --no-summary --no-verify --ignore-scripts --global --cwd --backend --link-native-bins --ca --cafile --network-concurrency --save-text-lockfile --omit --lockfile-only --trust --concurrent-scripts --help";
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
            COMPREPLY=( $(compgen -W "--version --cwd --help --canary -v -h") );
            return;;
        run)
            _file_arguments "!(*.@(js|ts|jsx|tsx|mjs|cjs)?($|))";
            COMPREPLY+=( $(compgen -W "--version --cwd --help --silent -v -h" -- "${cur_word}" ) );
            _read_scripts_in_package_json;
            return;;
        pm)
            _long_short_completion \
                "${PM_OPTIONS[LONG_OPTIONS]} ${PM_OPTIONS[SHORT_OPTIONS]}";
            COMPREPLY+=( $(compgen -W "bin ls cache hash hash-print hash-string audit pack migrate untrusted trust default-trusted whoami version view" -- "${cur_word}") );
            return;;
        test)
            _long_short_completion \
                "--timeout --update-snapshots --rerun-each --only --todo --coverage --coverage-reporter --coverage-dir --bail --test-name-pattern --reporter --reporter-outfile" "-u -t"
            return;;
        build)
            COMPREPLY=( $(compgen -W "--production --compile --bytecode --watch --no-clear-screen --target --outdir --outfile --sourcemap --minify --minify-syntax --minify-whitespace --minify-identifiers --format --banner --footer --root --splitting --public-path --entry-naming --chunk-naming --asset-naming --react-fast-refresh --no-bundle --emit-dce-annotations --css-chunking --conditions --app --server-components --env --windows-hide-console --windows-icon --debug-dump-server-files --debug-no-minify --external --packages" -- "${cur_word}") );
            return;;
        audit)
            COMPREPLY=( $(compgen -W "--json" -- "${cur_word}") );
            return;;
        info)
            _long_short_completion \
                "--config --yarn --production --no-save --save --ca --cafile --dry-run --frozen-lockfile --force --cache-dir --no-cache --silent --verbose --no-progress --no-summary --no-verify --ignore-scripts --trust --global --cwd --backend --registry --network-concurrency --save-text-lockfile --omit --lockfile-only --concurrent-scripts --json --help" \
                "-c -y -p -f -g -h";
            return;;
        patch-commit)
            COMPREPLY=( $(compgen -W "--patches-dir" -- "${cur_word}") );
            return;;
        init)
            COMPREPLY=( $(compgen -W "--help --yes --minimal --react --react=tailwind --react=shadcn -y -m -r" -- "${cur_word}") );
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
