# This is terribly complicated
# It's because:
# 1. bun run has to have dynamic completions
# 2. there are global options
# 3. bun {install add remove} gets special options
# 4. I don't know how to write fish completions well
# Contributions very welcome!!

function __fish__get_bun_bins
	string split ' ' (bun getcompletes b)
end

function __fish__get_bun_scripts
	set -lx SHELL bash
	set -lx MAX_DESCRIPTION_LEN 40
	string trim (string split '\n' (string split '\t' (bun getcompletes z)))
end

function __fish__get_bun_packages
	if test (commandline -ct) != ""
		set -lx SHELL fish
		string split ' ' (bun getcompletes a (commandline -ct))
	end
end

function __history_completions
	set -l tokens (commandline --current-process --tokenize)
	history --prefix (commandline) | string replace -r \^$tokens[1]\\s\* "" | string replace -r \^$tokens[2]\\s\* "" | string split ' '
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

set -l bun_install_boolean_flags yarn production optional development no-save dry-run force no-cache silent verbose global
set -l bun_install_boolean_flags_descriptions "Write a yarn.lock file (yarn v1)" "Don't install devDependencies" "Add dependency to optionalDependencies" "Add dependency to devDependencies" "Don't install devDependencies" "Don't install anything" "Always request the latest versions from the registry & reinstall all dependencies" "Ignore manifest cache entirely" "Don't output anything" "Excessively verbose logging" "Use global folder"

set -l bun_builtin_cmds dev create help bun upgrade discord run install remove add init link unlink pm x
set -l bun_builtin_cmds_without_run dev create help bun upgrade discord install remove add init pm x
set -l bun_builtin_cmds_without_bun dev create help upgrade run discord install remove add init pm x
set -l bun_builtin_cmds_without_create dev help bun upgrade discord run install remove add init pm x
set -l bun_builtin_cmds_without_install create dev help bun upgrade discord run remove add init pm x
set -l bun_builtin_cmds_without_remove create dev help bun upgrade discord run install add init pm x
set -l bun_builtin_cmds_without_add create dev help bun upgrade discord run remove install init pm x
set -l bun_builtin_cmds_without_pm create dev help bun upgrade discord run init pm x

# clear
complete -e -c bun

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_use_subcommand" -a '(__fish__get_bun_scripts)' -d 'script'
complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_bins)' -d 'package bin'
complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_scripts)' -d 'script'
complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_run; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from run" -a '(__fish__get_bun_bun_js_files)' -d 'Bun.js'
complete -c bun \
	-n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) and __fish_use_subcommand" -a 'run' -f -d 'Run a script or bin' 
complete -c bun \
	-n "not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) install remove add;" --no-files -s 'u' -l 'origin' -r -d 'Server URL. Rewrites import paths'
complete -c bun \
	-n "not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) install remove add;" --no-files  -s 'p' -l 'port' -r -d 'Port number to start server from' 
complete -c bun \
	-n "not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) install remove add;" --no-files  -s 'd' -l 'define' -r -d 'Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:\"development\"' 
complete -c bun \
	-n "not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) install remove add;" --no-files  -s 'e' -l 'external' -r -d 'Exclude module from transpilation (can use * wildcards). ex: -e react' 
complete -c bun \
	-n "not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) install remove add;" --no-files -l 'use' -r -d 'Use a framework (ex: next)' 
complete -c bun \
	-n "not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) install remove add;" --no-files -l 'hot' -r -d 'Enable hot reloading in Bun\'s JavaScript runtime' 
	
complete -c bun \
	-n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) and __fish_use_subcommand" -a 'dev' -d 'Start dev server'
complete -c bun \
	-n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) and __bun_command_count 1 and __fish_use_subcommand" -a 'create' -f -d 'Create a new project from a template' 

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create next react; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from create;" -a 'next' -d 'new Next.js project'

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create next react; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from create;" -a 'react' -d 'new React project'

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_use_subcommand" -a 'upgrade' -d 'Upgrade bun to the latest version' -x 
complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_use_subcommand"  -a '--help' -d 'See all commands and flags' -x

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_use_subcommand" -l "version" -s "v"  -a '--version' -d 'Bun\'s version' -x
complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_use_subcommand" -a 'discord' -d 'Open bun\'s Discord server' -x 


complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_bun; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); __fish_use_subcommand" -a 'bun' -d 'Generate a new bundle'


complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_bun; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from bun" -F -d 'Bundle this'

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_create; and not __fish_seen_subcommand_from (__fish__get_bun_bins); and not __fish_seen_subcommand_from (__fish__get_bun_scripts); and __fish_seen_subcommand_from react; or __fish_seen_subcommand_from next" -F -d "Create in directory"


complete -c bun \
	-n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) and __bun_command_count 1 and __fish_use_subcommand" -a 'init' -F -d 'Start an empty Bun project' 

complete -c bun \
	-n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) and __bun_command_count 1 and __fish_use_subcommand" -a 'install' -f -d 'Install packages from package.json' 

complete -c bun \
	-n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) and __bun_command_count 1 and __fish_use_subcommand" -a 'add' -F -d 'Add a package to package.json' 
	
complete -c bun \
	-n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) and __bun_command_count 1 and __fish_use_subcommand" -a 'remove' -F -d 'Remove a package from package.json' 

complete -c bun \
	-n "bun_fish_is_nth_token 1; and not __fish_seen_subcommand_from $bun_builtin_cmds; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) and __bun_command_count 1 and __fish_use_subcommand add remove" -F

		  
for i in (seq (count $bun_install_boolean_flags))
	complete -c bun \
		-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_pm; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from install add remove;" -l "$bun_install_boolean_flags[$i]" -d "$bun_install_boolean_flags_descriptions[$i]"
end

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_pm; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from install add remove;" -l 'cwd' -d 'Change working directory'

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_pm; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from install add remove;" -l 'cache-dir' -d 'Choose a cache directory (default: $HOME/.bun/install/cache)'

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_pm; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from add;" -d 'Popular' -a '(__fish__get_bun_packages)'

complete -c bun \
	-n "not __fish_seen_subcommand_from $bun_builtin_cmds_without_pm; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts); and __fish_seen_subcommand_from add;" -d 'History' -a '(__history_completions)'
  
complete -c bun \
	-n "__fish_seen_subcommand_from pm; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts) cache;" -a 'bin ls cache hash hash-print hash-string' -f

complete -c bun \
	-n "__fish_seen_subcommand_from pm; and __fish_seen_subcommand_from cache; and not __fish_seen_subcommand_from (__fish__get_bun_bins) (__fish__get_bun_scripts);" -a 'rm' -f

complete -c bun -n "not __fish_seen_subcommand_from $bun_builtin_cmds (__fish__get_bun_bins) (__fish__get_bun_scripts)" -a "$bun_builtin_cmds" -f