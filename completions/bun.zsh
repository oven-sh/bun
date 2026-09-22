#compdef bun
# Bun completions for zsh

_bun_run_param_script_completion() {
    local -a scripts_list bins
    local target_cwd="${PWD}"
    local cwd_specified=0
    local i val
    for (( i=1; i < ${#words[@]}; i++ )); do
        val=""
        if [[ "${words[i]}" == "--cwd" && -n "${words[i+1]}" ]]; then
            val="${words[i+1]}"
            cwd_specified=1
        elif [[ "${words[i]}" == --cwd=* ]]; then
            val="${words[i]#--cwd=}"
            cwd_specified=1
        fi
        if [[ -n "${val}" ]]; then
            val="${val%\"}"
            val="${val#\"}"
            val="${val%\'}"
            val="${val#\'}"
            val="${val/#\~/$HOME}"
            target_cwd="${val}"
        fi
    done

    local orig_pwd="${PWD}"
    local switched=0
    if (( cwd_specified )); then
        if [[ ! -d "${target_cwd}" ]] || ! builtin cd -q "${target_cwd}" 2>/dev/null; then
            return
        fi
        switched=1
    fi

    scripts_list=(${(f)"$(SHELL=zsh bun getcompletes s 2>/dev/null)"})
    bins=(${(f)"$(SHELL=zsh bun getcompletes b 2>/dev/null)"})

    if (( switched )); then
        builtin cd -q "${orig_pwd}" 2>/dev/null
    fi

    _alternative "scripts:scripts:compadd -a scripts_list"
    _alternative "bin:bin:compadd -a bins"
    _alternative "files:file:_files -W ${(q)target_cwd} -g '*.(js|mjs|cjs|ts|jsx|tsx|wasm)'"
}

_bun_link_param_package_completion() {
    # Read packages from ~/.bun/install/global/node_modules
    install_env=$BUN_INSTALL
    install_dir=${(P)install_env:-$HOME/.bun}
    global_node_modules=$install_dir/install/global/node_modules

    local -a packages_full_path=(${global_node_modules}/*(N))
    local -a packages=(${packages_full_path:t})
    _alternative "dirs:directory:compadd -a packages"
}

_bun_remove_param_package_completion() {
    local pkg_dir="${PWD}"
    local cwd_specified=0
    local i val
    for (( i=1; i < ${#words[@]}; i++ )); do
        val=""
        if [[ "${words[i]}" == "--cwd" && -n "${words[i+1]}" ]]; then
            val="${words[i+1]}"
            cwd_specified=1
        elif [[ "${words[i]}" == --cwd=* ]]; then
            val="${words[i]#--cwd=}"
            cwd_specified=1
        fi
        if [[ -n "${val}" ]]; then
            val="${val%\"}"
            val="${val#\"}"
            val="${val%\'}"
            val="${val#\'}"
            val="${val/#\~/$HOME}"
            pkg_dir="${val}"
        fi
    done

    if (( cwd_specified )) && [[ ! -d "${pkg_dir}" ]]; then
        return
    fi

    local pkg_file="${pkg_dir}/package.json"
    if [[ -f "${pkg_file}" && -r "${pkg_file}" ]]; then
        local -a deps
        deps=( "${(@f)$(BUN_PACKAGE_FILE="${pkg_file}" bun -e '
            const pkg = await Bun.file(process.env.BUN_PACKAGE_FILE).json();
            for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
                if (pkg[section] && typeof pkg[section] === "object") {
                    for (const name of Object.keys(pkg[section])) console.log(name);
                }
            }
        ' 2>/dev/null)}" )
        deps=(${deps:#})

        if (( ${#deps} > 0 )); then
            _alternative "deps:dependency:compadd -a deps"
        fi
    fi
}

_bun_test_param_script_completion() {
    local -a scripts_list

    _alternative "files:file:_files -g '*(_|.)(test|spec).(js|ts|jsx|tsx)'"
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

_bunx() {
    local curcontext="${curcontext}" context state state_descr line
    typeset -A opt_args
    local target_cwd="${PWD}"
    local cwd_specified=0
    local i val
    for (( i=1; i < CURRENT; i++ )); do
        val=""
        if [[ "${words[i]}" == "--cwd" ]] && (( i + 1 < CURRENT )) && [[ -n "${words[i+1]}" ]]; then
            val="${words[i+1]}"
            cwd_specified=1
        elif [[ "${words[i]}" == --cwd=* ]]; then
            val="${words[i]#--cwd=}"
            cwd_specified=1
        fi
        if [[ -n "${val}" ]]; then
            val="${val%\"}"
            val="${val#\"}"
            val="${val%\'}"
            val="${val#\'}"
            val="${val/#\~/$HOME}"
            target_cwd="${val}"
        fi
    done

    local orig_pwd="${PWD}"
    local switched=0
    if (( cwd_specified )); then
        if [[ ! -d "${target_cwd}" ]] || ! builtin cd -q "${target_cwd}" 2>/dev/null; then
            return
        fi
        switched=1
    fi

    local -a bins
    bins=(${(f)"$(SHELL=zsh bun getcompletes b 2>/dev/null)"})

    if (( switched )); then
        builtin cd -q "${orig_pwd}" 2>/dev/null
    fi

    _arguments -C \
        '(-b --bun)'{-b,--bun}'[Run with Bun runtime]' \
        '(-p --package)'{-p,--package}'[Explicit package name]:package:' \
        '--no-install[Do not install package]' \
        '--verbose[Show verbose output]' \
        '--silent[Silence output]' \
        '(-h --help)'{-h,--help}'[Print help]' \
        '--cwd=[Change working directory]:directory:_files -W ${(q)target_cwd} -/' \
        '1:package:->pkg' \
        '*::arguments:->rest' && return 0

    case "$state" in
        pkg)
            _alternative \
                "bin:bin:compadd -a bins" \
                "files:file:_files -W ${(q)target_cwd}"
            ;;
        rest)
            _files -W ${(q)target_cwd}
            ;;
    esac
}

if ! command -v compinit >/dev/null; then
    autoload -U compinit && compinit
fi

compdef _bun bun
compdef _bunx bunx
