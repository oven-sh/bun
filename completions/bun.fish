function __fish__get_bun_bins
    string split ' ' (bun getcompletes b)
end

function __fish__get_bun_scripts
    set -lx SHELL bash
    set -lx MAX_DESCRIPTION_LEN 40
    string trim (string split '\n' (string split '\t' (bun getcompletes z)))
end

function __fish__get_bun_bun_js_files
    string split ' ' (bun getcompletes j)
end

function bun_fish_is_nth_token --description 'Test if current token is on Nth place' --argument-names n
    set -l tokens (commandline -poc)
    set -l tokens (string replace -r --filter '^([^-].*)' '$1' -- $tokens)
    test (count $tokens) -eq "$n"
end

function __bun_command_count --argument-names n
    set -l cmds (commandline -poc)

    test (count cmds) -eq "$n"
end

function __bun_last_cmd --argument-names n
    set -l cmds (commandline -poc)

    test "(cmds[-1])" = "$n"
end

set -l bun_builtin_cmds dev create help bun upgrade discord run
set -l bun_builtin_cmds_without_run dev create help bun upgrade discord
set -l bun_builtin_cmds_without_bun dev create help upgrade run discord
set -l bun_builtin_cmds_without_create dev help bun upgrade discord run

complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -a '(__fish__get_bun_scripts)' -d 'script'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_bins)' -d 'package bin'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_scripts)' -d 'script'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_bun_js_files)' -d 'Bun.js'
complete -c bun \
    -n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts) and __fish_use_subcommand" -a 'run' -f -d 'Run a script or bin' 
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" --no-files -s 'u' -l 'origin' -r -d 'Server URL. Rewrites import paths'
complete -c bun \
-n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" --no-files  -s 'p' -l 'port' -r -d 'Port number to start server from' 
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" --no-files  -s 'd' -l 'define' -r -d 'Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\"' 
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" --no-files  -s 'e' -l 'external' -r -d 'Exclude module from transpilation (can use * wildcards). ex: -e react' 
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" --no-files -l 'use' -r -d 'Use a framework (ex: next)' 
complete -c bun \
    -n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts) and __fish_use_subcommand" -a 'dev' -d 'Start dev server'
complete -c bun \
    -n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts) and __bun_command_count 1 and __fish_use_subcommand" -a 'create' -f -d 'Create a new project' 

complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create next react; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from create;" -a 'next' -d 'new Next.js project'

complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create next react; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from create;" -a 'react' -d 'new React project'

complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -a 'upgrade' -d 'Upgrade Bun to the latest version' -x 
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand"  -a '--help' -d 'See all commands and flags' -x

complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -l "version" -s "v"  -a '--version' -d 'Bun\'s version' -x
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -a 'discord' -d 'Open Bun\'s Discord server' -x 


complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_bun; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); __fish_use_subcommand" -a 'bun' -d 'Generate a new bundle'


complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_bun; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from bun" -F -d 'Bundle this'

complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from react; or __fish_seen_subcommand_from next" -F -d "Create in directory"

complete -c bun --no-files