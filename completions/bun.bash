# adds the directories, and the files that match the pattern
_file_arguments() {
    local pattern="${1}";
    local file;

    while IFS= read -r file; do
        if [[ -d "${file}" ]]; then
            # a subcommand goes before a directory of the same name: `bun te<TAB>` gives `bun test `
            [[ " ${COMPREPLY[*]} " == *" ${file} "* ]] || COMPREPLY+=( "${file}/" );
        elif [[ "${file}" == ${pattern} ]]; then
            COMPREPLY+=( "${file}" );
        fi
    done < <(compgen -f -- "${cur_word}")

    # no space after a directory, so that the next <TAB> lists what is in it
    [[ "${#COMPREPLY[@]}" -eq 1 && "${COMPREPLY[0]}" == */ ]] && compopt -o nospace 2>/dev/null;
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
        scripts="${scripts//[\"\']/}";
        readarray -td, scripts <<<"${scripts}";
        for completion in "${scripts[@]}"; do
            [[ "${completion}" =~ ^[[:space:]]*([[:alnum:]@/:._-]+)[[:space:]]*: ]] && package_json_compreply+=( "${BASH_REMATCH[1]}" );
        done
        COMPREPLY+=( $(compgen -W "${package_json_compreply[*]}" -- "${cur_word}") );
    }

    # when a script is passed as an option, do not show other scripts as part of the completion anymore
    local re_prev_script="(^| )${prev}($| )";
    [[
        ( "${COMPREPLY[*]}" =~ ${re_prev_script} && -n "${COMP_WORDS[2]}" )
    ]] && {
        local filtered_reply=();
        local reply_word script_name keep;
        for reply_word in "${COMPREPLY[@]}"; do
            keep=1;
            for script_name in "${package_json_compreply[@]}"; do
                [[ "${reply_word}" == "${script_name}" ]] && { keep=""; break; };
            done
            [[ -n "${keep}" ]] && filtered_reply+=( "${reply_word}" );
        done
        COMPREPLY=( "${filtered_reply[@]}" );
    }
}


_bun_completions() {
    declare -A GLOBAL_OPTIONS;
    declare -A PACKAGE_OPTIONS;
    declare -A PM_OPTIONS;

    local SUBCOMMANDS="dev bun create run install add remove upgrade completions discord help init pm x test repl update audit dedupe prune outdated publish link unlink build check lint fmt";
    local RUNNABLE_FILES="*.@(js|mjs|cjs|ts|mts|cts|jsx|tsx|wasm|html)";

    GLOBAL_OPTIONS[LONG_OPTIONS]="--use --cwd --bunfile --server-bunfile --config --disable-react-fast-refresh --disable-hmr --env-file --extension-order --jsx-factory --jsx-fragment --extension-order --jsx-factory --jsx-fragment --jsx-import-source --jsx-production --jsx-runtime --main-fields --no-summary --version --platform --public-dir --tsconfig-override --define --external --help --inject --loader --origin --port --hot --watch --no-clear-screen --smol --bun --silent --preload --require --import --inspect --inspect-brk --inspect-wait";
    GLOBAL_OPTIONS[SHORT_OPTIONS]="-c -v -d -e -h -i -l -u -p -b -r";

    PACKAGE_OPTIONS[ADD_OPTIONS_LONG]="--development --optional --peer --save-prod --catalog --filter";
    PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]="-d -F";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_LONG]="--filter";
    PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]="-F";
    PACKAGE_OPTIONS[UPDATE_OPTIONS_LONG]="--latest --interactive --recursive --filter --dev --development --prod --no-optional --exact";
    PACKAGE_OPTIONS[UPDATE_OPTIONS_SHORT]="-L -i -r -F -d -D -P -E";

    PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]="--config --yarn --production --frozen-lockfile --no-save --dry-run --force --cache-dir --no-cache --silent --verbose --global --cwd --backend --help";
    PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]="-c -y -p -f -g";

    PACKAGE_OPTIONS[DEDUPE_OPTIONS_LONG]="--check";
    PACKAGE_OPTIONS[PRUNE_OPTIONS_LONG]="--production --prod --omit --filter --dry-run --check --os --cpu --libc --linker --silent --cwd --help";
    PACKAGE_OPTIONS[PRUNE_OPTIONS_SHORT]="-p -P -F -h";
    PACKAGE_OPTIONS[AUDIT_OPTIONS_LONG]="--json --audit-level --ignore --prod --production --omit --dry-run --latest --cwd --help";
    PACKAGE_OPTIONS[AUDIT_OPTIONS_SHORT]="-L";

    PM_OPTIONS[LONG_OPTIONS]="--config --yarn --production --frozen-lockfile --no-save --dry-run --force --cache-dir --no-cache --silent --verbose --no-progress --no-summary --no-verify --ignore-scripts --global --cwd --backend --json --help"
    PM_OPTIONS[SHORT_OPTIONS]="-c -y -p -f -g"

    local cur_word="${COMP_WORDS[${COMP_CWORD}]}";
    local prev="${COMP_WORDS[$(( COMP_CWORD - 1 ))]}";

    # the subcommand or file: the first word that is not a flag or the value of one (`bun --hot run`, `bun --cwd dir run`)
    local first_word="" i;
    for (( i=1; i < COMP_CWORD; i++ )); do
        case "${COMP_WORDS[i]}" in
            # readline splits `--flag=value` and `K:V` at the `=` and the `:`
            =|:) (( i++ ));;
            --cwd|--env-file|--preload|--require|--import|--filter|--define|--loader|--port|--conditions|--tsconfig-override|-r|-F|-d|-l)
                (( i++ )); [[ "${COMP_WORDS[i]}" == "=" ]] && (( i++ ));;
            -*) ;;
            *) first_word="${COMP_WORDS[i]}"; break;;
        esac
    done

    case "${prev}" in
        help|--help|-h|-v|--version) return;;
        -c|--config)      _file_arguments "*.toml"; return;;
        --bunfile)        _file_arguments "*.bun"; return;;
        --server-bunfile) _file_arguments "*.server.bun"; return;;
        --backend)
            case "${first_word}" in
                a|add|remove|rm|install|i|dedupe|update|up)
                    COMPREPLY=( $(compgen -W "clonefile copyfile hardlink clonefile_each_dir symlink" -- "${cur_word}") );
                    ;;
            esac
            return ;;
        --omit)
            COMPREPLY=( $(compgen -W "dev optional peer" -- "${cur_word}") );
            return;;
        -F|--filter)
            case "${first_word}" in
                a|add|remove|rm|i|install|prune|update|up) return;;
            esac
            ;;
        --linker)
            COMPREPLY=( $(compgen -W "isolated hoisted" -- "${cur_word}") );
            return;;
        --libc)
            COMPREPLY=( $(compgen -W "glibc musl" -- "${cur_word}") );
            return;;
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

    case "${first_word}" in
        help|completions) return;;
        add|a)
            _long_short_completion \
                "${PACKAGE_OPTIONS[ADD_OPTIONS_LONG]} ${PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[ADD_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}"
            return;;
        remove|rm|i|install)
            _long_short_completion \
                "${PACKAGE_OPTIONS[REMOVE_OPTIONS_LONG]} ${PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[REMOVE_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}";
            return;;
        update|up)
            _long_short_completion \
                "${PACKAGE_OPTIONS[UPDATE_OPTIONS_LONG]} ${PACKAGE_OPTIONS[UPDATE_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[UPDATE_OPTIONS_SHORT]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}";
            return;;
        link|unlink)
            _long_short_completion \
                "${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}";
            return;;
        dedupe)
            _long_short_completion \
                "${PACKAGE_OPTIONS[DEDUPE_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_LONG]} ${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[SHARED_OPTIONS_SHORT]}";
            return;;
        prune)
            _long_short_completion \
                "${PACKAGE_OPTIONS[PRUNE_OPTIONS_LONG]} ${PACKAGE_OPTIONS[PRUNE_OPTIONS_SHORT]}" \
                "${PACKAGE_OPTIONS[PRUNE_OPTIONS_SHORT]}";
            return;;
        audit)
            COMPREPLY=( $(compgen -W "fix ${PACKAGE_OPTIONS[AUDIT_OPTIONS_LONG]} ${PACKAGE_OPTIONS[AUDIT_OPTIONS_SHORT]}" -- "${cur_word}") );
            return;;
        publish)
            COMPREPLY=( $(compgen -f -W "--recursive --filter --access --tag --otp --auth-type --gzip-level --tolerate-republish --dry-run --ignore-scripts --registry --config --silent --verbose --cwd --help -r -F -c -h" -- "${cur_word}") );
            return;;
        x)
            COMPREPLY=( $(compgen -W "--bun --package --no-install --cwd --env-file --minimum-release-age --trust --verbose --silent --help -p -h" -- "${cur_word}") );
            return;;
        check)
            COMPREPLY=( $(compgen -f -W "--project --pretty --build --no-pretty --all --threads --timing --cwd --no-script --help -p -b -h" -- "${cur_word}") );
            return;;
        lint)
            COMPREPLY=( $(compgen -f -W "--config --no-config-lookup --rule --rules --explain --init --global --no-inline-config --report-unused-disable-directives --print-config --doctor --allow-unsupported --staged --changed --ignore-pattern --ignore-path --no-ignore --ext --stdin --stdin-filename --list-files --no-error-on-unmatched-pattern --cwd --format --all --output-file --quiet --max-warnings --color --no-color --timing --fix --fix-dry-run --fix-type --fix-suggestions --fix-dangerously --type-aware --no-type-aware --tsconfig --type-check --infer-globals --no-infer-globals --threads --no-script --version --help --help-all --flavor --project --parser-options --parser --plugin --native-plugin-rules --no-native-plugin-rules --report-unused-disable-directives-severity --report-unused-inline-configs --no-warn-ignored --suppress-all --suppress-rule --suppressions-location --prune-suppressions --pass-on-unpruned-suppressions --pass-on-no-patterns --exit-on-fatal-error --concurrency --env-info --no-eslintrc --env --rulesdir --resolve-plugins-relative-to --allow --warn --deny --deny-warnings --silent --disable-nested-config --import-plugin --react-plugin --jsdoc-plugin --jest-plugin --vitest-plugin --jsx-a11y-plugin --nextjs-plugin --react-perf-plugin --promise-plugin --node-plugin --vue-plugin --disable-unicorn-plugin --disable-oxc-plugin --disable-typescript-plugin -c -f -o -v -h -p -A -W -D" -- "${cur_word}") );
            return;;
        fmt)
            COMPREPLY=( $(compgen -f -W "--config --no-config --no-editorconfig --init --doctor --print-width --tab-width --use-tabs --no-semi --single-quote --jsx-single-quote --quote-props --trailing-comma --no-bracket-spacing --bracket-same-line --arrow-parens --object-wrap --single-attribute-per-line --html-whitespace-sensitivity --vue-indent-script-and-style --prose-wrap --embedded-language-formatting --end-of-line --no-insert-final-newline --sort-imports --sort-tailwindcss --sort-package-json --jsdoc --svelte --no-svelte --staged --changed --stdin-filepath --ignore-path --ignore-pattern --with-node-modules --no-error-on-unmatched-pattern --ignore-unknown --allow-unsupported --list-files --cwd --check --list-different --log-level --format --color --no-color --timing --threads --debug-check --no-script --version --help --all --help-all --write --config-precedence --find-config-path --parser --plugin --require-pragma --check-ignore-pragma --insert-pragma --range-start --range-end --cursor-offset --experimental-ternaries --experimental-operator-position --jsx-bracket-same-line --flavor --disable-nested-config -u -c -l -f -v -h -w" -- "${cur_word}") );
            return;;
        create|c)
            COMPREPLY=( $(compgen -W "--force --no-install --help --no-git --verbose --no-package-json --open next react" -- "${cur_word}") );
            return;;
        upgrade)
            COMPREPLY=( $(compgen -W "--version --cwd --help -v -h") );
            return;;
        repl)
            COMPREPLY=( $(compgen -W "--help -h --eval -e --print -p --preload -r --smol --config -c --cwd --env-file --no-env-file" -- "${cur_word}") );
            return;;
        run)
            _read_scripts_in_package_json;
            COMPREPLY+=( $(compgen -W "--version --cwd --help --silent -v -h" -- "${cur_word}" ) );
            _file_arguments "${RUNNABLE_FILES}";
            return;;
        pm)
            _long_short_completion \
                "${PM_OPTIONS[LONG_OPTIONS]} ${PM_OPTIONS[SHORT_OPTIONS]}";
            COMPREPLY+=( $(compgen -W "bin ls licenses cache hash hash-print hash-string" -- "${cur_word}") );
            return;;
        "")
            _long_short_completion \
                "${GLOBAL_OPTIONS[*]}" \
                "${GLOBAL_OPTIONS[SHORT_OPTIONS]}"
            [[ "${cur_word}" != -* ]] && {
                COMPREPLY+=( $(compgen -W "${SUBCOMMANDS}" -- "${cur_word}") );
                _file_arguments "${RUNNABLE_FILES}";
            }
            return;;
        *)
            _long_short_completion \
                "${GLOBAL_OPTIONS[*]}" \
                "${GLOBAL_OPTIONS[SHORT_OPTIONS]}"
            [[ "${cur_word}" != -* ]] && _file_arguments "*";
            return;;
    esac

}

complete -F _bun_completions bun
