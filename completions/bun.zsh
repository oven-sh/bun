__bun_first_cmd() {
    echo "${words[2]}"
}

__bun_first_cmd_arg() {
    echo "${words[3]}"
}

__bun_arg_count() {
    echo "$#words"
}

_bun_run() {
    if [[ ("$(__bun_arg_count)" = "2") ]]; then
      local -a options
        options=(${(f)"$(SHELL=zsh bun getcompletes)"})

        _describe 'values' options
    elif [[ ("$(__bun_arg_count)" = "3") ]]; then
        local -a run
        run=("${(f)"$(SHELL=zsh bun getcompletes g)"}")
        compadd $run
    else
        _files
        return
    fi

    # Make sure we don't run default completion
    custom_completion=true
}

_bun() {

    # Store custom completion status
    local custom_completion=false

    # Load custom completion commands
    case "$(__bun_first_cmd)" in
    create)
        return;
        ;;
    dev)
        return;
        ;;
    bun)
        return;
        ;;
    upgrade)
        return;
        ;;
    discord)
        return;
        ;;
    run)
        _bun_run
        ;;
    esac

    # Fall back to default completion if we haven't done a custom one
    [[ $custom_completion = false ]] && _bun_run
}

compdef _bun bun
