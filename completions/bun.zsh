#compdef bun

local _bun_generic_options=(
    '(: -)'{-h,--help}'[Show command help]'
    '(: -)'{-v,--version}'[Show version and exit]'
)

# Helper's definitions
function _bun_env_completion() {
    local -a _node_env_describe _node_env _envs
    local _regex

    _regex=' -(d|-define) process\.env\.NODE_ENV:.+ '
    if [[ ! ${words[@]} =~ $_regex ]]; then
        _node_env_describe=(
            'development -- Define mode as development'
            'production  -- Define mode as production'
            'test        -- Define mode as test'
        )
        _node_env=(
            '"development"'
            '"production"'
            '"test"'
        )
        # -l Vertical list
        # -Q No scape double quotes
        # -P (Prefix) insert a prefix before each item
        # -J Group name
        compadd -l -Q -P 'process.env.NODE_ENV:' -J node-mode -d _node_env_describe -a _node_env
    fi

    # Since the values are parsed as json, append a double quote in string values
    # and replace single quotes with double quotes
    # ${(f)} convert lines to array. because when processed with
    # sed it must be converted.
    #
    # Environment variables can have any value.
    # for example line breaks. by processing it with '${(f)}'
    # we make sure that when autocompleting they are treated as a string.
    #
    # In my case this environment variable:
    #   "FZF_DEFAULT_OPTS=$'\n--color fg:7,hl:12,fg+:234,bg+:248,hl+:1\n'"
    # broke the autocomplete and with '${(f)}' I solved it
    _envs=(
        #${(f)"$(export | sed -r "/^\w+=(true|false|null|[0-9]+)$/! s/='?(.*?)('|$)/=\"\1\"/")"}
        # Don't use PERL regExp because is not supported by MacOS and BSD
        ${(f)"$(export | sed -E "/^[[:alnum:]_]+=(true|false|null|[0-9])$/! s/='(.*)'$|=(.*)$/=\"\1\2\"/")"}
    )
    compadd -Q -J envs -a -- _envs
}

function _bun_add_package_completion() {
    local -a _recent _popular
    #_recent=($(history -n | grep -oP '(?<=^bun add ).+'))
    # Don't use PERL regExp because is not supported by MacOS and BSD
    _recent=(
        ${(f)"$(history -n | sed -nE 's/^(bun[[:space:]]+add[[:space:]]+)(.+)$/\2/p' | xargs printf '%q\n' | grep -vE '^-{1,2}[[:alnum:]]')"}
    )
    _popular=($(SHELL=zsh bun getcompletes a))

    if [ ${#_recent[@]} -gt 0 ]; then
        compadd -Q -J recent -X 'Recent:' -a -- _recent
    fi

    if [ ${#_popular[@]} -gt 0 ]; then
        compadd -Q -J popular -X 'Popular:' -a -- _popular
    fi
}

function _bun_remove_package_completion() {
    local -a _dependencies _dev_dependencies _peer_dependencies _optional_dependencies

    if ! command -v jq >/dev/null 2>&1; then
        _message 'jq is required to complete bun remove command'
        return
    fi

    _dependencies=($(jq -r '.dependencies | keys[]' package.json 2>/dev/null))

    _dev_dependencies=($(jq -r '.devDependencies | keys[]' package.json 2>/dev/null))

    _peer_dependencies=($(jq -r '.peerDependencies | keys[]' package.json 2>/dev/null))

    _optional_dependencies=($(jq -r '.optionalDependencies | keys[]' package.json 2>/dev/null))

    if [ ${#_dependencies[@]} -gt 0 ]; then
        compadd -Q -J dependencies -X 'Dependencies:' -a -- _dependencies
    fi

    if [ ${#_dev_dependencies[@]} -gt 0 ]; then
        compadd -Q -J dev-dependencies -X 'Dev Dependencies:' -a -- _dev_dependencies
    fi

    if [ ${#_peer_dependencies[@]} -gt 0 ]; then
        compadd -Q -J peer-dependencies -X 'Peer Dependencies:' -a -- _peer_dependencies
    fi

    if [ ${#_optional_dependencies[@]} -gt 0 ]; then
        compadd -Q -J optional-dependencies -X 'Optional Dependencies:' -a -- _optional_dependencies
    fi
}

function _bun_run_completion() {
    local -a _scripts _bins _files

    _files=($(SHELL=zsh bun getcompletes j))

    _bins=($(SHELL=zsh bun getcompletes b))

    _scripts=($(SHELL=zsh bun getcompletes s))

    if [ ${#_scripts[@]} -gt 0 ]; then
        compadd -J scripts -X 'Scripts:' -a -- _scripts
    fi

    if [ ${#_files[@]} -gt 0 ]; then
        compadd -J files -X 'Files:' -a -- _files
    fi

    if [ ${#_bins[@]} -gt 0 ]; then
        compadd -J bins -X 'Bins:' -a -- _bins
    fi
}

function _bun_loader_completion() {
    # Since chargers are defined as
    # .extension:loader e.g. .js:jsx
    # this will autocomplete with the most popular extensions followed by a valid loader
    local -a _loaders _loaders_describe _popular_extensions
    local cur=${words[CURRENT]}

    _popular_extensions=(
        'jsx'
        'js'
        'mjs'
        'cjs'
        'cjsx'
        'mjsx'
        'json'
        'tsx'
        'ts'
        'css'
        'html'
        'htm'
        'md'
        'txt'
        'xml'
        'yml'
        'yaml'
        'conf'
        'toml'
        'jsonc'
        'toml'
    )

    _loaders=(
        'jsx'
        'js'
        'json'
        'tsx'
        'ts'
        'css'
    )

    _loaders_describe=(
        'jsx  -- Define loader as jsx'
        'js   -- Define loader as js'
        'json -- Define loader as json'
        'tsx  -- Define loader as tsx'
        'ts   -- Define loader as ts'
        'css  -- Define loader as css'
    )
    if [[ ! "$cur" =~ ^\..+: ]]; then
        compadd -P '.' -S ':' -a _popular_extensions
    else
        compadd -l -P "${cur%%:*}:" -d _loaders_describe -a _loaders
    fi
    # Zsh has a specific function to do this '_sep_parts'
    # It is assumed that the above segment (if statement) can be simplified to:
    #  _sep_parts -P '.' _popular_extensions : _loaders
    # But for some unknown reason it doesn't work.
}

function _bun_command_create_describe_create() {
    local -a _describe_create

    _describe_create=(
        'next:Create a new Next.js project'
        'react:Create a new React project'
    )

    _describe 'create' _describe_create
}

# Commands definition's
function _bun_command_add() {
    _arguments -S \
        $_bun_generic_options \
        '*: :_bun_add_package_completion' \
        {-c,--config}'[Load config (bunfig.toml)]:config:_files -g "*.toml"' \
        {-y,--yarn}'[Write a yarn.lock file (yarn v1)]' \
        {-p,--production}'[Don'"'"'t install devDependencies]' \
        '(--lockfile)--no-save[Don'"'"'t save a lockfile]' \
        '--dry-run[Don'"'"'t install anything]' \
        '(--no-save)--lockfile[Store & load a lockfile at a specific filepath]:lockfile:_files' \
        {-f,--force}'[Always request the latest versions from the registry & reinstall all dependenices]' \
        '(--no-cache)--cache-dir[Store & load cached data from a specific directory path]:cache-dir:_dir_list' \
        '(--cache-dir)--no-cache[Ignore manifest cache entirely]' \
        '(--verbose)--silent[Don'"'"'t output anything]' \
        '(--silent)--verbose[Excessively verbose logging]' \
        {-g,--global}'[Add a package globally]' \
        '--cwd[Change directory]:cwd:_dir_list' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:(clonefile copyfile hardlink clonefile_each_dir)' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--registry[Change default registry (default: \$BUN_CONFIG_REGISTRY || \$npm_config_registry)]:registry' \
        '--token[Authentication token used for npm registry requests (default: \$npm_config_token)]:token' \
        '(--optional)'{-d,--development}'[Add dependency to devDependencies]' \
        '(-d --development)--optional[Add dependency to optionalDependencies]'
}

function _bun_command_bun() {
    _arguments -S \
        $_bun_generic_options \
        "*:file:_files" \
        '--cwd[Change directory]:cwd:_dir_list' \
        '--use[Use a framework, e.g. "next"]:use'
}

function _bun_command_create() {
    _arguments -S \
        $_bun_generic_options \
        '1: :_bun_command_create_describe_create' \
        '2:directory:_dir_list' \
        '--force[Overwrite existing files]' \
        '--no-install[Don'"'"'t install node_modules]' \
        '--no-git[Don'"'"'t create a git repository]' \
        '--verbose[Too many logs]' \
        '--no-package-json[Disable package.json transforms]' \
        '--open[On finish, start bun & open in-browser]'
}

function _bun_command_dev() {
    _arguments -S \
        $_bun_generic_options \
        '--use[Use a framework, e.g. "next"]:use' \
        '--bunfile[Use a specific .bun file (default: node_modules.bun)]:bunfile:_files' \
        '--server-bunfile[Use a specific .bun file for SSR in bun dev (default: node_modules.server.bun)]:server-bunfile:_files' \
        '--cwd[Change directory]:cwd:_dir_list' \
        {-c,--config}'[Config file to load bun from]:config:_files -g "*.toml"' \
        '--extension-order[defaults to: .tsx,.ts,.jsx,.js,.json]:extension-order' \
        '--disable-react-fast-refresh[Disable React Fast Refresh]' \
        '--disable-hmr[Disable Hot Module Reloading]' \
        '--jsx-factory[Changes the function called when compiling JSX elements using the classic JSX runtime]:jsx-factory' \
        '--jsx-fragment[Changes the function called when compiling JSX fragments]:jsx-fragment' \
        '--jsx-import-source[Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: "react"]:jsx-import-source' \
        '--jsx-production[Use jsx instead of jsxDEV (default) for the automatic runtime]' \
        '--jsx-runtime[JSX runtime to use. Defaults to "automatic"]:jsx-runtime:(automatic classic)' \
        '--main-fields[Main fields to lookup in package.json. Defaults to --platform dependent]:main-fields' \
        '--no-summary[Don'"'"'t print a summary (when generating .bun]' \
        '--platform[Platform to use. Defaults to "browser"]:platform:(node browser)' \
        '--public-dir[Top-level directory for .html files, fonts or anything external. Defaults to "<cwd>/public"]:public-dir:_dir_list' \
        '--tsconfig-override[Path to tsconfig.json to override]:tsconfig-override:_files -g "*.json"' \
        \*{-d,--define}'[Define a variable to be passed to the bundler in format json key="value"]:define:_bun_env_completion' \
        '--external[Exclude module from transpilation]:external:_files' \
        {-i,--inject}'[Inject module at the top of every file]:inject' \
        \*{-l,--loader}'[Parse files with .ext:loader]:loader:_bun_loader_completion' \
        {-u,--origin}'[Rewrite import paths to start from a different url. Default: ""]:origin' \
        {-p,--port}'[Port number]:port' \
        '--silent[Don'"'"'t repeat the command for bun run]'
}

function _bun_command_help() {
    _arguments -S \
        $_bun_generic_options
}

function _bun_command_install() {
    _arguments -S \
        $_bun_generic_options \
        {-c,--config}'[Load config (bunfig.toml)]:config:_files -g "*.toml"' \
        {-y,--yarn}'[Write a yarn.lock file (yarn v1)]' \
        {-p,--production}'[Don'"'"'t install devDependencies]' \
        '(--lockfile)--no-save[Don'"'"'t save a lockfile]' \
        '--dry-run[Don'"'"'t install anything]' \
        '(--no-save)--lockfile[Store & load a lockfile at a specific filepath]:lockfile:_files' \
        {-f,--force}'[Always request the latest versions from the registry & reinstall all dependenices]' \
        '(--no-cache)--cache-dir[Store & load cached data from a specific directory path]:cache-dir:_dir_list' \
        '(--cache-dir)--no-cache[Ignore manifest cache entirely]' \
        '(--verbose)--silent[Don'"'"'t output anything]' \
        '(--silent)--verbose[Excessively verbose logging]' \
        {-g,--global}'[Add a package globally]' \
        '--cwd[Change directory]:cwd:_dir_list' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:(clonefile copyfile hardlink clonefile_each_dir )' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--registry[Change default registry (default: \$BUN_CONFIG_REGISTRY || \$npm_config_registry)]:registry' \
        '--token[Authentication token used for npm registry requests (default: \$npm_config_token)]:token'
}

function _bun_command_remove() {
    _arguments -S \
        $_bun_generic_options \
        '*: :_bun_remove_package_completion' \
        {-c,--config}'[Load config (bunfig.toml)]:config:_files -g "*.toml"' \
        {-y,--yarn}'[Write a yarn.lock file (yarn v1)]' \
        {-p,--production}'[Don'"'"'t install devDependencies]' \
        '(--lockfile)--no-save[Don'"'"'t save a lockfile]' \
        '--dry-run[Don'"'"'t install anything]' \
        '(--no-save)--lockfile[Store & load a lockfile at a specific filepath]:lockfile:_files' \
        {-f,--force}'[Always request the latest versions from the registry & reinstall all dependenices]' \
        '(--no-cache)--cache-dir[Store & load cached data from a specific directory path]:cache-dir:_dir_list' \
        '(--cache-dir)--no-cache[Ignore manifest cache entirely]' \
        '(--verbose)--silent[Don'"'"'t output anything]' \
        '(--silent)--verbose[Excessively verbose logging]' \
        {-g,--global}'[Remove a package globally]' \
        '--cwd[Change directory]:cwd:_dir_list' \
        '--backend[Platform-specific optimizations for installing dependencies]:backend:(clonefile copyfile hardlink clonefile_each_dir )' \
        '--link-native-bins[Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo]:link-native-bins' \
        '--registry[Change default registry (default: \$BUN_CONFIG_REGISTRY || \$npm_config_registry)]:registry' \
        '--token[Authentication token used for npm registry requests (default: \$npm_config_token)]:token'
}

function _bun_command_run() {
    _arguments -S \
        $_bun_generic_options \
        '1: :_bun_run_completion' \
        '--cwd[Change directory]:cwd:_dir_list' \
        '--silent[Don'"'"'t echo the command]'
}

function _bun_command_upgrade() {
    _arguments -S \
        $_bun_generic_options \
        '--cwd[Change directory]:cwd:_dir_list'
}

# Commands declaration
function _bun_describe_commands() {
    local -a _bun_commands

    _bun_commands=(
        'add:Add a dependency to package.json'
        'bun:Generate a bundle'
        'create:Create a new project'
        'dev:Start a dev server'
        'help:Show command help'
        'install:Install packages from package.json'
        'remove:Remove a dependency from package.json'
        'run:Run a script or package bin'
        'upgrade:Upgrade to the latest version of bun'
    )

    _describe 'command' _bun_commands
}

function _bun_exec_command() {
    local command="${line[1]}"
    # To define new commands add a function as
    # name '_bun_command_COMMAND_NAME'
    # This will save us creating an esac case statement.
    # example:
    #   1. bun run -> _bun_command_run
    #   2. bun help -> _bun_command_help
    #   3. bun install -> _bun_command_install

    if ! type -f _bun_command_$command &>/dev/null; then
        _message "unknown command: $command"
        return
    else
        _bun_command_$command
    fi
}

function _bun() {
    _arguments -S \
        $_bun_generic_options \
        '1: :_bun_describe_commands' \
        '*::command:_bun_exec_command'
    #'*::command:_bun_command_${line[1]}'
    # Please dont't this method for complete other commands
    # because the performance is not good.
}

autoload -U compinit && compinit
compdef _bun bun

# ex: ts=4 sw=4 et filetype=zsh
