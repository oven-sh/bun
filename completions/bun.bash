#!/usr/bin/env bash

_escape_bash_specials() {
    local word="${1}"
    local escape_all="${2}"

    local re_exp
    local re_sed

    if ((escape_all)); then
        # escape all bash specials: ]~$"'`><()[{}=|*?;&#\
        re_exp='[]~$\"'"\'"'\`><\()[{\}=|*?;&#\\]'
        re_sed='[]~$"'\''`><()[{}=|*?;&#\]'
    else
        # escape all bash specials _except_ " (quote) and \ (backslash)
        # since they are already escaped in package.json: ]~$'`><()[{}=|*?;&#
        re_exp='[]~$'"\'"'\`><\()[{\}=|*?;&#]'
        re_sed='[]~$'\''`><()[{}=|*?;&#]'
    fi

    local has_patsub=0
    shopt -s patsub_replacement 2> /dev/null && {
        # shellcheck disable=SC2064 # current state of `patsub_replacement` is needed
        trap "$(shopt -p patsub_replacement)" RETURN
        has_patsub=1
    }

    if ((has_patsub)); then
        echo "${word//${re_exp}/\\&}"
    else
        # shellcheck disable=SC2001 # substitution insidde parameter expansion can be used if 'patsub_replacement' option is available
        sed "s/${re_sed}/\\\\&/g" <<< "${word}"
    fi
}

_is_exist_and_gnu() {
    local cmd="${1}"
    local version_string
    version_string="$(
        command -v "$cmd" > /dev/null 2>&1 &&
            "$cmd" --version 2> /dev/null | head -1
    )"
    [[ $version_string == *GNU* ]] && return 0 || return 1
}

_file_arguments() {
    local extensions="${1}"
    local cur_word="${2}"

    local -a candidates
    if _is_exist_and_gnu find && _is_exist_and_gnu sed; then
        readarray -t -d '' candidates < <(
            find . -regextype posix-extended -maxdepth 1 \
                -xtype f -regex "${extensions}" -name "${cur_word}*" -printf '%f\0' |
                sed -z "s/\n/\$'n'/g"
        )
    else
        # the following two `readarray` assumes that filenames has
        # no newline characters in it, otherwise they will be splitted
        # into separate completions.
        if [[ -z ${cur_word} ]]; then
            readarray -t candidates <<< "$(compgen -f)"
        else
            readarray -t candidates <<< "$(compgen -f -- "${cur_word}")"
        fi
        # if pathname expansion above produces no matching files, then
        # `compgen` output single newline character `\n`, resulting in
        # singleton `candidates` with empty string, let us mitigate this.
        [[ -z ${candidates[0]} ]] && candidates=()
    fi

    for cnd in "${candidates[@]}"; do
        [[ -f ${cnd} && ${cnd} =~ ${extensions} ]] &&
            COMPREPLY+=("$(_escape_bash_specials "${cnd##*/}" 1)")
    done
}

_long_short_completion() {
    local long_opts="${1}"
    local short_opts="${2}"
    local cur_word="${3}"

    if [[ -z ${cur_word} ]]; then
        # shellcheck disable=SC2207 # the `wordlist` is constant and has no whitespace characters inside each word
        COMPREPLY+=($(compgen -W "${long_opts} ${short_opts}"))
    elif [[ ${cur_word} == --* ]]; then
        # shellcheck disable=SC2207 # idem.
        COMPREPLY+=($(compgen -W "${long_opts}" -- "${cur_word}"))
    elif [[ ${cur_word} == -* ]]; then
        # shellcheck disable=SC2207 # idem.
        COMPREPLY+=($(compgen -W "${long_opts} ${short_opts}" -- "${cur_word}"))
        return
    fi
}


# appends the script names from package.json inside the current directory, if any, to the list of completions
# @param `$1`: string - word imidiatelly before the cursor
# @param `$2`: string - word before $1`
_bun_scripts_completions() {
    local cur_word="${1}"
    local pre_word="${2}"

    local package_json
    local working_dir="${PWD}"
    local line=0

    for (( ; line < ${#COMP_WORDS[@]}; line += 1)); do
        [[ ${COMP_WORDS[${line}]} == "--cwd" ]] && working_dir="${COMP_WORDS[line + 1]}"
    done

    [[ -f "${working_dir}/package.json" ]] && package_json=$(< "${working_dir}/package.json")

    [[ ${package_json} =~ '"scripts"'[[:space:]]*':'[[:space:]]*\{[[:space:]]*(.*)\} ]] && {
        local matched="${BASH_REMATCH[1]}"
        local scripts="${matched%\}*}"
        local -a script_candidates

        while [[ ${scripts} =~ ^'"'(([^\"\\]|\\.)+)'"'[[:space:]]*":"[[:space:]]*'"'(([^\"\\]|\\.)*)'"'[[:space:]]*(,[[:space:]]*|$) ]]; do
            local script
            script="$(_escape_bash_specials "${BASH_REMATCH[1]}" 0)"

            # when a script is passed as an option, do not show other scripts as part of the completion anymore
            [[ ${script} == "${pre_word}" ]] && return 1

            script_candidates+=("${script}")
            scripts="${scripts:${#BASH_REMATCH[0]}}"
        done
    }

    for script in "${script_candidates[@]}"; do
        [[ ${script} == "${cur_word}"* ]] && COMPREPLY+=("${script}")
    done
    return 0
}


# appends subcommands to the list of completions
# @param `$1`: string - word imidiatelly before the cursor
# @param `$2`: string - word before $1`
_bun_subcommand_completions() {
    local cur_word="${1}"
    local pre_word="${2}"

    local subcommands=(
			dev
			create
			run
			install
			add
			remove
			upgrade
			completions
			discord
			help
			init
			pm
			x
			test
			repl
			update
			outdated
			link
			unlink
			build
		)

    [[ ${pre_word} == 'bun' ]] && {
        if [[ -z ${cur_word} ]]; then
            # shellcheck disable=SC2207 # `sub_commands` is constant space dilimited list
            COMPREPLY+=($(compgen -W "${subcommands[*]}"))
        else
            # shellcheck disable=SC2207 # idem.
            COMPREPLY+=($(compgen -W "${subcommands[*]}" -- "${cur_word}"))
        fi
    }
}

_bun_completions() {
    GLOBAL_OPTIONS_LONG=(
			--use
			--cwd
			--bunfile
			--server-bunfile
			--config
			--disable-react-fast-refresh
			--disable-hmr
			--env-file
			--extension-order
			--jsx-factory
			--jsx-fragment
			--extension-order
			--jsx-factory
			--jsx-fragment
			--jsx-import-source
			--jsx-production
			--jsx-runtime
			--main-fields
			--no-summary
			--version
			--platform
			--public-dir
			--tsconfig-override
			--define
			--external
			--help
			--inject
			--loader
			--origin
			--port
			--dump-environment-variables
			--dump-limits
			--disable-bun-js
		)
    GLOBAL_OPTIONS_SHORT=(-c -v -d -e -h -i -l -u -p)

    PACKAGE_OPTIONS_ADD_LONG=(--development --optional --peer)
    PACKAGE_OPTIONS_ADD_SHORT=()

    PACKAGE_OPTIONS_REMOVE_LONG=()
    PACKAGE_OPTIONS_REMOVE_SHORT=()

    PACKAGE_OPTIONS_SHARED_LONG=(
			--config
			--yarn
			--production
			--frozen-lockfile
			--no-save
			--dry-run
			--force
			--cache-dir
			--no-cache
			--silent
			--verbose
			--global
			--cwd
			--backend
			--link-native-bins
			--help
		)
    PACKAGE_OPTIONS_SHARED_SHORT=(-c -y -p -f -g)

    PM_OPTIONS_LONG=(
			--config
			--yarn
			--production
			--frozen-lockfile
			--no-save
			--dry-run
			--force
			--cache-dir
			--no-cache
			--silent
			--verbose
			--no-progress
			--no-summary
			--no-verify
			--ignore-scripts
			--global
			--cwd
			--backend
			--link-native-bins
			--help
		)
    PM_OPTIONS_SHORT=(-c -y -p -f -g)

		local fst_word="${COMP_WORDS[1]}"
    local pre_word="${COMP_WORDS[$((COMP_CWORD - 1))]}"
    local cur_word="${COMP_WORDS[${COMP_CWORD}]}"

    case "${pre_word}" in
    help | --help | -h | -v | --version) return ;;
    -c | --config) _file_arguments '.+\.toml$' "${cur_word}" && return ;;
    --bunfile) _file_arguments '.+\.bun$' "${cur_word}" && return ;;
    --server-bunfile) _file_arguments '.+\.server\.bun$' "${cur_word}" && return ;;
    --backend)
        case "${fst_word}" in
        a | add | remove | rm | install | i)
						local backend_args=(
							clonefile
							copyfile
							hardlink
							clonefile_each_dir
							symlink
						)
            # shellcheck disable=SC2207 # `backend_args` is array of words with no space inside each element
            COMPREPLY=($(compgen -W "${backend_args[*]}" -- "${cur_word}"))
            ;;
        esac
        return
        ;;
    --cwd | --public-dir)
        readarray -t COMPREPLY <<< "$(compgen -d -- "${cur_word}")"
        return
        ;;
    --jsx-runtime)
				local jsx_runtime_args=(automatic classic)
        # shellcheck disable=SC2207 # see above
        COMPREPLY=($(compgen -W "${jsx_runtime_args[*]}" -- "${cur_word}"))
        return
        ;;
    --target)
				local target_args=(browser node bun)
        # shellcheck disable=SC2207 # see above
        COMPREPLY=($(compgen -W "${target_args[*]}" -- "${cur_word}"))
        return
        ;;
    -l | --loader)
        [[ ${cur_word} =~ (:) ]] && {
            local cur_word_wo_suffix="${cur_word%%:*}"
            local loader_args=(
              jsx
              js
              json
              tsx
              ts
              css
            )
            readarray -t COMPREPLY <<< "$(
              compgen -W "${loader_args[@]/#/${cur_word_wo_suffix}:}" -- "${cur_word}"
            )"
        }
        return
        ;;
    esac

    case "${fst_word}" in
    help | completions | --help | -h | -v | --version) return ;;
    add | a)
        _bun_long_short_completions \
            "${PACKAGE_OPTIONS_ADD_LONG[*]} ${PACKAGE_OPTIONS_SHARED_LONG[*]}" \
            "${PACKAGE_OPTIONS_ADD_SHORT[*]} ${PACKAGE_OPTIONS_SHARED_SHORT[*]}" \
            "${cur_word}"
        return
        ;;
    remove | rm | i | install | link | unlink)
        _bun_long_short_completions \
            "${PACKAGE_OPTIONS_REMOVE_LONG[*]} ${PACKAGE_OPTIONS_SHARED_LONG[*]}" \
            "${PACKAGE_OPTIONS_REMOVE_SHORT[*]} ${PACKAGE_OPTIONS_SHARED_SHORT[*]}" \
            "${cur_word}"
        return
        ;;
    create | c)
        local create_options=(
          --force
          --no-install
          --help
          --no-git
          --verbose
          --no-package-json
          --open next react
        )
        # shellcheck disable=SC2207 # `create_options` is array of words with no space inside each element
        COMPREPLY=($(compgen -W "${create_options[*]}" -- "${cur_word}"))
        return
        ;;
    upgrade)
        local upgrade_options=(
          --version
          --cwd
          --help
          -v
          -h
        )
        # shellcheck disable=SC2207 # see above
        COMPREPLY=($(compgen -W "${upgrade_options[*]}" -- "${cur_word}"))
        return
        ;;
    run)
        _bun_files_completions '.+\.(js|ts|jsx|tsx|mjs|cjs)$' "${cur_word}"
        local run_options=(
          --version
          --cwd
          --help
          --silent
          -v
          -h
        )
        # shellcheck disable=SC2207 # see above
        COMPREPLY+=($(compgen -W "${run_options[*]}" -- "${cur_word}"))
        _bun_scripts_completions "${cur_word}" "${pre_word}"
        return
        ;;
    pm)
        _bun_scripts_completions \
            "${PM_OPTIONS_LONG[*]}" \
            "${PM_OPTIONS_SHORT[*]}" \
            "${cur_word}"
        local pm_options=(
          bin
          ls
          cache
          hash
          hash-print
          hash-string
        )
        # shellcheck disable=SC2207 # see above
        COMPREPLY+=($(compgen -W "${pm_options[*]}" -- "${cur_word}"))
        return
        ;;
    *)
        _bun_scripts_completions \
            "${GLOBAL_OPTIONS_LONG[*]}" \
            "${GLOBAL_OPTIONS_SHORT[*]}" \
            "${cur_word}"
        local pre_is_script=0
        _bun_scripts_completions "${cur_word}" "${pre_word}" || pre_is_script=1
        _bun_subcommand_completions "${cur_word}" "${pre_word}"

        # determine if completion should be continued when
        # the current word is an empty string and either:
        # a. the previous word is part of the allowed completion
        # b. the previous word is an argument to second-to-previous option
        # c. the previouos word is the script name
        # FIXME: Is c. a valid case here?
        [[ -z ${cur_word} ]] && {
            for comp in "${COMPREPLY[@]}"; do
                # if `pre_word` is script name, then scripts are filtred out from `COMPREPLY`, so
                # the `_pre_is_script` is needed to detect that previous word is the script name
                [[ ${pre_word} == "${comp}" ]] && return # a.
            done

            local pre_pre_word="${COMP_WORDS[COMP_CWORD - 2]}"
            local global_options_with_arg=(
							--bunfile
							--server-bunfile
							--config
							--port
							--cwd
							--public-dir
							--jsx-runtime
							--platform
							--loader
						)

            for opt in "${global_options_with_arg[@]}"; do
                [[ ${pre_pre_word} == "${opt}" ]] && return # b.
            done

            ((pre_is_script)) && return # c.

            unset COMPREPLY
        }
        return
        ;;
    esac
}

complete -F _bun_completions bun
