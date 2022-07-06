#/usr/bin/env bash

LONG_OPTIONS=(
    "--use"
    "--bunfile"
    "--server-bunfile"
    "--cwd"
    "--config"
    "--disable-react-fast-refresh"
    "--disable-hmr"
    "--extension-order"
    "--jsx-factory"
    "--jsx-fragment"
    "--extension-order"
    "--jsx-factory"
    "--jsx-fragment"
    "--jsx-import-source"
    "--jsx-production"
    "--jsx-runtime"
    "--main-fields"
    "--no-summary"
    "--version"
    "--platform"
    "--public-dir"
    "--tsconfig-override"
    "--define"
    "--external"
    "--help"
    "--inject"
    "--loader"
    "--origin"
    "--port"
    "--silent"
    "--dump-environment-variables"
    "--dump-limits"
    "--disable-bun.js"
);

SHORT_OPTIONS=( "-c"  "-v" "-d" "-e" "-h" "-i" "-l" "-u" "-p" );

file_arguments() {

    local cur_word="${1}";
    local extension="${2}";

    [[ -z "${cur_word}" ]] && {
        COMPREPLY=( $(compgen -G "*.${extension}" -- "${cur_word}"));
        return 0;
    }

    COMPREPLY=( $(compgen -fG "${cur_word}*.${extension}" -- "${cur_word}"));
}

_bun_completions() {

    local cur_word="${COMP_WORDS[${COMP_CWORD}]}"
    local prev="${COMP_WORDS[$(( COMP_CWORD - 1 ))]}"

    [[ "${cur_word}" =~ ^- ]] && {
        COMPREPLY=( $(compgen -W "${SHORT_OPTIONS[*]} ${LONG_OPTIONS[*]}" -- "${cur_word}"));
        return 0;
    }

    [[ "${cur_word}" =~ ^-[A-Za_z]+ ]] && {
        COMPREPLY=( $(compgen -W "${SHORT_OPTIONS[*]}" -- "${cur_word}"));
        return 0;
    }

    case "${prev}" in
        -c|--config)        file_arguments "${cur_word}" "toml";;
        --bunfile)          file_arguments "${cur_word}" "bun";;
        --server-bunfile)   file_arguments "${cur_word}" "server.bun";;
        --cwd|--public-dir) COMPREPLY=( $(compgen -d -- "${cur_word}" ) );;
        --jsx-runtime)      COMPREPLY=( $(compgen -W "automatic classic" -- "${cur_word}") );;
        --platform)         COMPREPLY=( $(compgen -W "browser node" -- "${cur_word}") );;
        -l|--loader)
            [[ "${cur_word:$(( ${#cur_word} - 1 )):1}" == ":" ]] && {
                COMPREPLY=( $(compgen -W "jsx js json tsx ts css") );
            }
            ;;
    esac

}

complete -F _bun_completions bun
