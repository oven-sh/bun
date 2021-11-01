function __fish__get_bun_bins
    string split ' ' (bun getcompletes b)
end

function __fish__get_bun_scripts
    string split ' ' (bun getcompletes s)
end

function __fish__get_bun_bun_js_files
    string split ' ' (bun getcompletes j)
end


set -l bun_builtin_cmds dev create help bun upgrade discord run
set -l bun_builtin_cmds_without_run dev create help bun upgrade discord
set -l bun_builtin_cmds_without_create dev help bun upgrade discord run

complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -a '(__fish__get_bun_bins)' -d 'package bin'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -a '(__fish__get_bun_scripts)' -d 'script'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_bins)' -d 'package bin'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_scripts)' -d 'script'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_bun_js_files)' -d 'Bun.js'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts) and __fish_use_subcommand" -a 'run' -f -d 'Run a script or bin' 
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" -F -s 'u' -l 'origin' -r -d 'Server URL. Rewrites import paths'
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" -F  -s 'p' -l 'port' -r -d 'Port number to start server from' 
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" -F  -s 'd' -l 'define' -r -d 'Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\"' 
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" -F  -s 'e' -l 'external' -r -d 'Exclude module from transpilation (can use * wildcards). ex: -e react' 
complete -c bun \
    -n "not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts);" -F -l 'use' -r -d 'Use a framework (ex: next)' 
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts) and __fish_use_subcommand" -a 'dev' -d 'Start dev server'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -F -a 'create'  -d 'Create a new project from a template'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create next react; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from create" -f -a 'next'  -d 'Create a new Next.js project'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create next react; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from create" -f -a 'react'  -d 'Create a new React project'
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from create next" -F
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -a 'upgrade' -d 'Upgrade Bun to the latest version' -x 
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand"  -a '--help' -d 'See all commands and flags' -x

complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -l "version" -s "v"  -a '--version' -d 'Bun\'s version' -x
complete -c bun \
    -n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not  __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_use_subcommand" -a 'discord' -d 'Open Bun\'s Discord server' -x 

