$_bun_subcommands = @{
  run         = 'Run JavaScript with Bun, a package.json script, or a bin'
  test        = 'Run unit tests with Bun'
  x           = 'Install and execute a package bin (bunx)'
  repl        = 'Start a REPL session with Bun'
  init        = 'Start-Process an empty Bun project from a blank template'
  create      = 'Create a new project from a template (bun c)'
  install     = 'Install dependencies for a package.json (bun i)'
  add         = 'Add a dependency to package.json (bun a)'
  remove      = 'Remove a dependency from package.json (bun rm)'
  update      = 'Update outdated dependencies & save to package.json'
  link        = 'Link an npm package globally'
  unlink      = 'Globally unlink an npm package'
  pm          = 'more commands for managing packages'
  build       = 'Bundle TypeScript & JavaScript into a single file'
  upgrade     = 'Get the latest version of bun'
  completions = 'Add shell tab-completions. `$ bun completions > path/to/file`'
  help        = 'Show all supported flags and commands'
  discord     = 'Print the invite to Discord server'
}.GetEnumerator() | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.Key, $_.Key, 'Command', $_.Value)
}

$_bun_subcommands_add = @(
  @{ name       = '--config'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '-c'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '--yarn'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '-y'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '--production'
    description = "Don't install devDependencies"
  },
  @{ name       = '-p'
    description = "Don't install devDependencies"
  },
  @{ name       = '--no-save'
    description = "Don't save a lockfile"
  },
  @{ name       = '--save'
    description = 'Save to package.json'
  },
  @{ name       = '--dry-run'
    description = "Don't install anything"
  },
  @{ name       = '--frozen-lockfile'
    description = 'Disallow changes to lockfile'
  },
  @{ name       = '--force'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '-f'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '--cache-dir'
    description = 'Store & load cached data from a specific directory path'
  },
  @{ name       = '--no-cache'
    description = 'Ignore manifest cache entirely'
  },
  @{ name       = '--silent'
    description = "Don't log anything"
  },
  @{ name       = '--verbose'
    description = 'Excessively verbose logging'
  },
  @{ name       = '--no-progress'
    description = 'Disable the progress bar'
  },
  @{ name       = '--no-summary'
    description = "Don't print a summary"
  },
  @{ name       = '--no-verify'
    description = 'Skip verifying integrity of newly downloaded packages'
  },
  @{ name       = '--ignore-scripts'
    description = 'Skip lifecycle scripts in the package.json (dependency scripts are never run)'
  },
  @{ name       = '--global'
    description = 'Add a package globally'
  },
  @{ name       = '-g'
    description = 'Add a package globally'
  },
  @{ name       = '--cwd'
    description = 'Set a specific cwd]:cw'
  },
  @{ name       = '--backend'
    description = 'Platform-specific optimizations for installing dependencies'
  },
  @{ name       = '--link-native-bins'
    description = 'Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo'
  },
  @{ name       = '--help'
    description = 'Print this help menu'
  },
  @{ name       = '--dev'
    description = 'Add dependence to "devDependencies'
  },
  @{ name       = '-d'
    description = 'Add dependence to "devDependencies'
  },
  @{ name       = '--development'
    description = " "
  },
  @{ name       = '--optional'
    description = 'Add dependency to "optionalDependencies'
  },
  @{ name       = '--exact'
    description = 'Add the exact version instead of the ^range'
  }) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_unlink = @(
  @{ name       = '--config'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '-c'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '--yarn'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '-y'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '--production'
    description = "Don't install devDependencies"
  },
  @{ name       = '-p'
    description = "Don't install devDependencies"
  },
  @{ name       = '--no-save'
    description = "Don't save a lockfile"
  },
  @{ name       = '--save'
    description = 'Save to package.json'
  },
  @{ name       = '--dry-run'
    description = "Don't install anything"
  },
  @{ name       = '--frozen-lockfile'
    description = 'Disallow changes to lockfile'
  },
  @{ name       = '--force'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '-f'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '--cache-dir'
    description = 'Store & load cached data from a specific directory path'
  },
  @{ name       = '--no-cache'
    description = 'Ignore manifest cache entirely'
  },
  @{ name       = '--silent'
    description = "Don't log anything"
  },
  @{ name       = '--verbose'
    description = 'Excessively verbose logging'
  },
  @{ name       = '--no-progress'
    description = 'Disable the progress bar'
  },
  @{ name       = '--no-summary'
    description = "Don't print a summary"
  },
  @{ name       = '--no-verify'
    description = 'Skip verifying integrity of newly downloaded packages'
  },
  @{ name       = '--ignore-scripts'
    description = 'Skip lifecycle scripts in the package.json (dependency scripts are never run)'
  },
  @{ name       = '--global'
    description = 'Add a package globally'
  },
  @{ name       = '-g'
    description = 'Add a package globally'
  },
  @{ name       = '--cwd'
    description = 'Set a specific cwd'
  },
  @{ name       = '--backend'
    description = 'Platform-specific optimizations for installing dependencies'
  },
  @{ name       = '--link-native-bins'
    description = 'Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo'
  },
  @{ name       = '--help'
    description = 'Print this help menu'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_link = @(
  @{ name       = '--config'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '-c'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '--yarn'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '-y'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '--production'
    description = "Don't install devDependencies"
  },
  @{ name       = '-p'
    description = "Don't install devDependencies"
  },
  @{ name       = '--no-save'
    description = "Don't save a lockfile"
  },
  @{ name       = '--save'
    description = 'Save to package.json'
  },
  @{ name       = '--dry-run'
    description = "Don't install anything"
  },
  @{ name       = '--frozen-lockfile'
    description = 'Disallow changes to lockfile'
  },
  @{ name       = '--force'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '-f'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '--cache-dir'
    description = 'Store & load cached data from a specific directory path'
  },
  @{ name       = '--no-cache'
    description = 'Ignore manifest cache entirely'
  },
  @{ name       = '--silent'
    description = "Don't log anything"
  },
  @{ name       = '--verbose'
    description = 'Excessively verbose logging'
  },
  @{ name       = '--no-progress'
    description = 'Disable the progress bar'
  },
  @{ name       = '--no-summary'
    description = "Don't print a summary"
  },
  @{ name       = '--no-verify'
    description = 'Skip verifying integrity of newly downloaded packages'
  },
  @{ name       = '--ignore-scripts'
    description = 'Skip lifecycle scripts in the package.json (dependency scripts are never run)'
  },
  @{ name       = '--global'
    description = 'Add a package globally'
  },
  @{ name       = '-g'
    description = 'Add a package globally'
  },
  @{ name       = '--cwd'
    description = 'Set a specific cwd'
  },
  @{ name       = '--backend'
    description = 'Platform-specific optimizations for installing dependencies'
  },
  @{ name       = '--link-native-bins'
    description = 'Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo'
  },
  @{ name       = '--help'
    description = 'Print this help menu'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_bun = @(
  @{ name       = '--version'
    description = 'Show version and exit'
  },
  @{ name       = '-V'
    description = 'Show version and exit'
  },
  @{ name       = '--cwd'
    description = 'Change directory'
  },
  @{ name       = '--help'
    description = 'Show command help'
  },
  @{ name       = '-h'
    description = 'Show command help'
  },
  @{ name       = '--use'
    description = 'Use a framework, e.g. "next"'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_init = @(
  @{ name       = '-y'
    description = 'Answer yes to all prompts'
  },
  @{ name       = '--yes'
    description = 'Answer yes to all prompts'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_create = @(
  @{ name       = "  '--force"
    description = 'Overwrite existing files'
  },
  @{ name       = '--no-install'
    description = "Don't install node_modules"
  },
  @{ name       = '--no-git'
    description = "Don't create a git repository"
  },
  @{ name       = '--verbose'
    description = 'verbose'
  },
  @{ name       = '--no-package-json'
    description = 'Disable package.json transforms'
  },
  @{ name       = '--open'
    description = 'On finish, start bun & open in-browser'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_pm = @(
  @{ name       = 'bin'
    description = 'print the path to bin folder'
  },
  @{ name       = 'ls'
    description = 'list the dependency tree according to the current lockfile'
  },
  @{ name       = 'hash'
    description = 'generate & print the hash of the current lockfile'
  },
  @{ name       = 'hash-string'
    description = 'print the string used to hash the lockfile'
  },
  @{ name       = 'hash-print'
    description = 'print the hash stored in the current lockfile'
  },
  @{ name       = 'cache'
    description = 'print the path to the cache folder'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_install = @(
  @{ name       = '--config'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '-c'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '--yarn'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '-y'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '--production'
    description = "Don't install devDependencies"
  },
  @{ name       = '-p'
    description = "Don't install devDependencies"
  },
  @{ name       = '--no-save'
    description = "Don't save a lockfile"
  },
  @{ name       = '--save'
    description = 'Save to package.json'
  },
  @{ name       = '--dry-run'
    description = "Don't install anything"
  },
  @{ name       = '--frozen-lockfile'
    description = 'Disallow changes to lockfile'
  },
  @{ name       = '--force'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '-f'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '--cache-dir'
    description = 'Store & load cached data from a specific directory path'
  },
  @{ name       = '--no-cache'
    description = 'Ignore manifest cache entirely'
  },
  @{ name       = '--silent'
    description = "Don't log anything"
  },
  @{ name       = '--verbose'
    description = 'Excessively verbose logging'
  },
  @{ name       = '--no-progress'
    description = 'Disable the progress bar'
  },
  @{ name       = '--no-summary'
    description = "Don't print a summary"
  },
  @{ name       = '--no-verify'
    description = 'Skip verifying integrity of newly downloaded packages'
  },
  @{ name       = '--ignore-scripts'
    description = 'Skip lifecycle scripts in the package.json (dependency scripts are never run)'
  },
  @{ name       = '--global'
    description = 'Add a package globally'
  },
  @{ name       = '-g'
    description = 'Add a package globally'
  },
  @{ name       = '--cwd'
    description = 'Set a specific cwd'
  },
  @{ name       = '--backend'
    description = 'Platform-specific optimizations for installing dependencies'
  },
  @{ name       = '--link-native-bins'
    description = 'Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo'
  },
  @{ name       = '--help'
    description = 'Print this help menu'
  },
  @{ name       = '--dev'
    description = 'Add dependence to "devDependencies'
  },
  @{ name       = '-d'
    description = 'Add dependence to "devDependencies'
  },
  @{ name       = '--development'
    description = " "
  },
  @{ name       = '-D'
    description = " "
  },
  @{ name       = '--optional'
    description = 'Add dependency to "optionalDependencies'
  },
  @{ name       = '--exact'
    description = 'Add the exact version instead of the ^range'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_remove = @(
  @{ name       = '--config'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '-c'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '--yarn'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '-y'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '--production'
    description = "Don't install devDependencies"
  },
  @{ name       = '-p'
    description = "Don't install devDependencies"
  },
  @{ name       = '--no-save'
    description = "Don't save a lockfile"
  },
  @{ name       = '--save'
    description = 'Save to package.json'
  },
  @{ name       = '--dry-run'
    description = "Don't install anything"
  },
  @{ name       = '--frozen-lockfile'
    description = 'Disallow changes to lockfile'
  },
  @{ name       = '--force'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '-f'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '--cache-dir'
    description = 'Store & load cached data from a specific directory path'
  },
  @{ name       = '--no-cache'
    description = 'Ignore manifest cache entirely'
  },
  @{ name       = '--silent'
    description = "Don't log anything"
  },
  @{ name       = '--verbose'
    description = 'Excessively verbose logging'
  },
  @{ name       = '--no-progress'
    description = 'Disable the progress bar'
  },
  @{ name       = '--no-summary'
    description = "Don't print a summary"
  },
  @{ name       = '--no-verify'
    description = 'Skip verifying integrity of newly downloaded packages'
  },
  @{ name       = '--ignore-scripts'
    description = 'Skip lifecycle scripts in the package.json (dependency scripts are never run)'
  },
  @{ name       = '--global'
    description = 'Add a package globally'
  },
  @{ name       = '-g'
    description = 'Add a package globally'
  },
  @{ name       = '--cwd'
    description = 'Set a specific cwd'
  },
  @{ name       = '--backend'
    description = 'Platform-specific optimizations for installing dependencies'
  },
  @{ name       = '--link-native-bins'
    description = 'Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo'
  },
  @{ name       = '--help'
    description = 'Print this help menu'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_run = @(
  @{ name       = '--help'
    description = 'Display this help and exit'
  },
  @{ name       = '-h'
    description = 'Display this help and exit'
  },
  @{ name       = '--bun'
    description = "Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)"
  },
  @{ name       = '-b'
    description = "Force a script or package to use Bun's runtime instead of Node.js (via symlinking node)"
  },
  @{ name       = '--cwd'
    description = 'Absolute path to resolve files & entry points from. This just changes the process cwd'
  },
  @{ name       = '--config'
    description = 'Config file to load bun from (e.g. -c bunfig.toml'
  },
  @{ name       = '-c'
    description = 'Config file to load bun from (e.g. -c bunfig.toml'
  },
  @{ name       = '--env-file'
    description = 'Load environment variables from the specified file(s)'
  },
  @{ name       = '--extension-order'
    description = 'Defaults to: .tsx,.ts,.jsx,.js,.json'
  },
  @{ name       = '--jsx-factory'
    description = 'Changes the function called when compiling JSX elements using the classic JSX runtime'
  },
  @{ name       = '--jsx-fragment'
    description = 'Changes the function called when compiling JSX fragments'
  },
  @{ name       = '--jsx-import-source'
    description = 'Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: "react"'
  },
  @{ name       = '--jsx-runtime'
    description = '"automatic" (default) or "classic"'
  },
  @{ name       = '--preload'
    description = 'Import a module before other modules are loaded'
  },
  @{ name       = '-r'
    description = 'Import a module before other modules are loaded'
  },
  @{ name       = '--main-fields'
    description = 'Main fields to lookup in package.json. Defaults to --target dependent'
  },
  @{ name       = '--no-summary'
    description = "Don't print a summary"
  },
  @{ name       = '--version'
    description = 'Print version and exit'
  },
  @{ name       = '-v'
    description = 'Print version and exit'
  },
  @{ name       = '--revision'
    description = 'Print version with revision and exit'
  },
  @{ name       = '--tsconfig-override'
    description = 'Load tsconfig from path instead of cwd/tsconfig.json'
  },
  @{ name       = '--define'
    description = 'Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.'
  },
  @{ name       = '-d'
    description = 'Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.'
  },
  @{ name       = '--external'
    description = 'Exclude module from transpilation (can use * wildcards). ex: -e react'
  },
  @{ name       = '-e'
    description = 'Exclude module from transpilation (can use * wildcards). ex: -e react'
  },
  @{ name       = '--loader'
    description = 'Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi'
  },
  @{ name       = '-l'
    description = 'Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi'
  },
  @{ name       = '--origin'
    description = 'Rewrite import URLs to start with --origin. Default: ""'
  },
  @{ name       = '-u'
    description = 'Rewrite import URLs to start with --origin. Default: ""'
  },
  @{ name       = '--port'
    description = "Port to serve bun's dev server on. Default: '3000'"
  },
  @{ name       = '-p'
    description = "Port to serve bun's dev server on. Default: '3000'"
  },
  @{ name       = '--smol'
    description = 'Use less memory, but run garbage collection more often'
  },
  @{ name       = '--minify'
    description = 'Minify (experimental)'
  },
  @{ name       = '--minify-syntax'
    description = 'Minify syntax and inline data (experimental)'
  },
  @{ name       = '--minify-whitespace'
    description = 'Minify Whitespace (experimental)'
  },
  @{ name       = '--minify-identifiers'
    description = 'Minify identifiers'
  },
  @{ name       = '--no-macros'
    description = 'Disable macros from being executed in the bundler, transpiler and runtime'
  },
  @{ name       = '--target'
    description = 'The intended execution environment for the bundle. "browser", "bun" or "node"'
  },
  @{ name       = '--inspect'
    description = "Activate Bun's Debugger"
  },
  @{ name       = '--inspect-wait'
    description = "Activate Bun's Debugger, wait for a connection before executing"
  },
  @{ name       = '--inspect-brk'
    description = "Activate Bun's Debugger, set breakpoint on first line of code and wait"
  },
  @{ name       = '--hot'
    description = "Enable auto reload in bun's JavaScript runtime"
  },
  @{ name       = '--watch'
    description = "Automatically restart bun's JavaScript runtime on file change"
  },
  @{ name       = '--no-install'
    description = "Disable auto install in bun's JavaScript runtime"
  },
  @{ name       = '--install'
    description = 'Install dependencies automatically when no node_modules are present, default: "auto". "force" to ignore node_modules, fallback to install any missing'
  },
  @{ name       = '-i'
    description = "Automatically install dependencies and use global cache in bun's runtime, equivalent to --install=fallback"
  },
  @{ name       = '--prefer-offline'
    description = "Skip staleness checks for packages in bun's JavaScript runtime and resolve from disk"
  },
  @{ name       = '--prefer-latest'
    description = "Use the latest matching versions of packages in bun's JavaScript runtime, always checking npm"
  },
  @{ name       = '--silent'
    description = "Don't repeat the command for bun run"
  },
  @{ name       = '--dump-environment-variables'
    description = 'Dump environment variables from .env and process as JSON and quit. Useful for debugging'
  },
  @{ name       = '--dump-limits'
    description = 'Dump system limits. Userful for debugging'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_upgrade = @(
  @{ name       = '--canary'
    description = 'Upgrade to canary build'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_build = @(
  @{ name       = '--outfile'
    description = 'Write the output to a specific file (default: stdout)'
  },
  @{ name       = '--outdir'
    description = 'Write the output to a directory (required for splitting)'
  },
  @{ name       = '--minify'
    description = 'Enable all minification flags'
  },
  @{ name       = '--minify-whitespace'
    description = 'Remove unneeded whitespace'
  },
  @{ name       = '--minify-syntax'
    description = 'Transform code to use less syntax'
  },
  @{ name       = '--minify-identifiers'
    description = 'Shorten variable names'
  },
  @{ name       = '--sourcemap'
    description = 'Generate sourcemaps'
  },
  @{ name       = '--target'
    description = 'The intended execution environment for the bundle. "browser", "bun" or "node"'
  },
  @{ name       = '--splitting'
    description = 'Whether to enable code splitting (requires --outdir)'
  },
  @{ name       = '--compile'
    description = 'generating a standalone binary from a TypeScript or JavaScript file'
  },
  @{ name       = '--format'
    description = 'Specifies the module format to be used in the generated bundles'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_update = @(
  @{ name       = '-c'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '--config'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '-y'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '--yarn'
    description = 'Write a yarn.lock file (yarn v1)'
  },
  @{ name       = '-p'
    description = "Don't install devDependencies"
  },
  @{ name       = '--production'
    description = "Don't install devDependencies"
  },
  @{ name       = '--no-save'
    description = "Don't save a lockfile"
  },
  @{ name       = '--save'
    description = 'Save to package.json'
  },
  @{ name       = '--dry-run'
    description = "Don't install anything"
  },
  @{ name       = '--frozen-lockfile'
    description = 'Disallow changes to lockfile'
  },
  @{ name       = '-f'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '--force'
    description = 'Always request the latest versions from the registry & reinstall all dependencies'
  },
  @{ name       = '--cache-dir'
    description = 'Store & load cached data from a specific directory path'
  },
  @{ name       = '--no-cache'
    description = 'Ignore manifest cache entirely'
  },
  @{ name       = '--silent'
    description = "Don't log anything"
  },
  @{ name       = '--verbose'
    description = 'Excessively verbose logging'
  },
  @{ name       = '--no-progress'
    description = 'Disable the progress bar'
  },
  @{ name       = '--no-summary'
    description = "Don't print a summary"
  },
  @{ name       = '--no-verify'
    description = 'Skip verifying integrity of newly downloaded packages'
  },
  @{ name       = '--ignore-scripts'
    description = 'Skip lifecycle scripts in the package.json (dependency scripts are never run)'
  },
  @{ name       = '-g'
    description = 'Add a package globally'
  },
  @{ name       = '--global'
    description = 'Add a package globally'
  },
  @{ name       = '--cwd'
    description = 'Set a specific cwd'
  },
  @{ name       = '--backend'
    description = 'Platform-specific optimizations for installing dependencies'
  },
  @{ name       = '--link-native-bins'
    description = 'Link "bin" from a matching platform-specific dependency instead. Default: esbuild, turbo'
  },
  @{ name       = '--help'
    description = 'Print this help menu'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_subcommands_test = @(
  @{ name       = '-h'
    description = 'Display this help and exit'
  },
  @{ name       = '--help'
    description = 'Display this help and exit'
  },
  @{ name       = '-b'
    description = 'Force a script or package to use Bun.js instead of Node.js (via symlinking node)'
  },
  @{ name       = '--bun'
    description = 'Force a script or package to use Bun.js instead of Node.js (via symlinking node)'
  },
  @{ name       = '--cwd'
    description = 'Set a specific cwd'
  },
  @{ name       = '-c'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '--config'
    description = 'Load config(bunfig.toml)'
  },
  @{ name       = '--env-file'
    description = 'Load environment variables from the specified file(s)'
  },
  @{ name       = '--extension-order'
    description = 'Defaults to: .tsx,.ts,.jsx,.js,.json'
  },
  @{ name       = '--jsx-factory'
    description = 'Changes the function called when compiling JSX elements using the classic JSX runtime'
  },
  @{ name       = '--jsx-fragment'
    description = 'Changes the function called when compiling JSX fragments'
  },
  @{ name       = '--jsx-import-source'
    description = 'Declares the module specifier to be used for importing the jsx and jsxs factory functions. Default: "react"'
  },
  @{ name       = '--jsx-runtime'
    description = '"automatic" (default) or "classic"'
  },
  @{ name       = '--preload'
    description = 'Import a module before other modules are loaded'
  },
  @{ name       = '-r'
    description = 'Import a module before other modules are loaded'
  },
  @{ name       = '--main-fields'
    description = 'Main fields to lookup in package.json. Defaults to --target dependent'
  },
  @{ name       = '--no-summary'
    description = "Don't print a summary"
  },
  @{ name       = '--version'
    description = 'Print version and exit'
  },
  @{ name       = '-v'
    description = 'Print version and exit'
  },
  @{ name       = '--revision'
    description = 'Print version with revision and exit'
  },
  @{ name       = '--tsconfig-override'
    description = 'Load tsconfig from path instead of cwd/tsconfig.json'
  },
  @{ name       = '--define'
    description = 'Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.'
  },
  @{ name       = '-d'
    description = 'Substitute K:V while parsing, e.g. --define process.env.NODE_ENV:"development". Values are parsed as JSON.'
  },
  @{ name       = '--external'
    description = 'Exclude module from transpilation (can use * wildcards). ex: -e react'
  },
  @{ name       = '-e'
    description = 'Exclude module from transpilation (can use * wildcards). ex: -e react'
  },
  @{ name       = '--loader'
    description = 'Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi'
  },
  @{ name       = '-l'
    description = 'Parse files with .ext:loader, e.g. --loader .js:jsx. Valid loaders: js, jsx, ts, tsx, json, toml, text, file, wasm, napi'
  },
  @{ name       = '--origin'
    description = 'Rewrite import URLs to start with --origin. Default: ""'
  },
  @{ name       = '-u'
    description = 'Rewrite import URLs to start with --origin. Default: ""'
  },
  @{ name       = '--port'
    description = "Port to serve bun's dev server on. Default: '3000'"
  },
  @{ name       = '-p'
    description = "Port to serve bun's dev server on. Default: '3000'"
  },
  @{ name       = '--smol'
    description = 'Use less memory, but run garbage collection more often'
  },
  @{ name       = '--minify'
    description = 'Minify (experimental)'
  },
  @{ name       = '--minify-syntax'
    description = 'Minify syntax and inline data (experimental)'
  },
  @{ name       = '--minify-identifiers'
    description = 'Minify identifiers'
  },
  @{ name       = '--no-macros'
    description = 'Disable macros from being executed in the bundler, transpiler and runtime'
  },
  @{ name       = '--target'
    description = 'The intended execution environment for the bundle. "browser", "bun" or "node"'
  },
  @{ name       = '--inspect'
    description = "Activate Bun's Debugger"
  },
  @{ name       = '--inspect-wait'
    description = "Activate Bun's Debugger, wait for a connection before executing"
  },
  @{ name       = '--inspect-brk'
    description = "Activate Bun's Debugger, set breakpoint on first line of code and wait"
  },
  @{ name       = '--watch'
    description = "Automatically restart bun's JavaScript runtime on file change"
  },
  @{ name       = '--timeout'
    description = 'Set the per-test timeout in milliseconds, default is 5000.'
  },
  @{ name       = '--update-snapshots'
    description = 'Update snapshot files'
  },
  @{ name       = '--rerun-each'
    description = 'Re-run each test file <NUMBER> times, helps catch certain bugs'
  },
  @{ name       = '--only'
    description = 'Only run tests that are marked with "test.only()"'
  },
  @{ name       = '--todo'
    description = 'Include tests that are marked with "test.todo()"'
  },
  @{ name       = '--coverage'
    description = 'Generate a coverage profile'
  },
  @{ name       = '--bail'
    description = 'Exit the test suite after <NUMBER> failures. If you do not specify a number, it defaults to 1.'
  },
  @{ name       = '--test-name-pattern'
    description = 'Run only tests with a name that matches the given regex'
  },
  @{ name       = '-t'
    description = 'Run only tests with a name that matches the given regex'
  }
) | ForEach-Object {
  [System.Management.Automation.CompletionResult]::new($_.name, $_.name, 'ParameterName', $_.description)
}

$_bun_get_cwd = {
  param([System.Collections.ObjectModel.ReadOnlyCollection[System.Management.Automation.Language.CommandElementAst]]$elements)
  for ($i = 0; $i -ne $elements.Count; ++$i) {
    if ($elements[$i].Value -eq "--cwd") { return $elements[$i + 1]; }
  }
  (Get-Location).Path # pwd is alias
}

$_bun_get_dependecies = {
  param($workingDir)
  if ($(Test-Path "$workingDir\package.json" -PathType Leaf) -eq $False) { return @() }
  $dependencies = $(Get-Content "$workingDir\package.json" | ConvertFrom-Json).dependencies
  $devDependencies = $(Get-Content "$workingDir\package.json" | ConvertFrom-Json).devDependencies
  (($dependencies | Get-Member -MemberType Properties | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'DynamicKeyword', $dependencies.$($_.Name))
    }) + ($devDependencies | Get-Member -MemberType Properties | ForEach-Object {
      [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'DynamicKeyword', $devDependencies.$($_.Name))
    }))
}

$_bun_get_scripts = {
  param($workingDir)
  if ($(Test-Path "$workingDir\package.json" -PathType Leaf) -eq $False) { return @() }
  $scripts = $(Get-Content "$workingDir\package.json" | ConvertFrom-Json).scripts
  $scripts | Get-Member -MemberType Properties | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'DynamicKeyword', $scripts.$($_.Name))
  }
}

$_bun_get_bins = {
  param($workingDir)
  $binDir = "$workingDir\node_modules\.bin"
  if ($(Test-Path $binDir -PathType Container) -eq $False) { return @() }
  ((Get-ChildItem -File -Path $binDir).Name -replace "\..+$", "" | Get-Unique) | ForEach-Object {
    $binExe = ((Get-Content $binDir\$_) -join "`n" | Select-String -Pattern "basedir/\.\.(/[^`"]+)").Matches.Groups[1].Value -replace '/', '\'
    [System.Management.Automation.CompletionResult]::new($_, $_, 'DynamicKeyword', "$(Get-Location)\node_modules$binExe")
  }
}

$_bun_get_files = {
  param($workingDir)
  $match = ((Get-ChildItem -File -Path $workingDir).Name | Select-String -Pattern '.+\.([mc]js|jsx?|[mc]ts|tsx?|wasm)$').Matches.Value
  if ($match -eq $null) { return @() }
  $match | ForEach-Object {
    $quoted = $_
    if ($_ -match "[^\d\w._-]|\s") { $quoted = "'$_'" }
    $full = "$workingDir\$_"
    if ((Test-Path -Path $full) -eq $False) { return }
    [System.Management.Automation.CompletionResult]::new($quoted, $_, 'Variable', (Resolve-Path $full))
  }
}

$_bun_current_param = {
  param($ast, $cursorPosition)
  $str = $ast.ToString().PadRight($cursorPosition)
  $j = $cursorPosition - 1
  if ($str[$j] -notmatch "\s") { while ($j-- -ne 0) { if ($str[$j] -match "\s") { break; } } }
  while ($j-- -ne 0) { if ($str[$j] -notmatch "\s") { break; } }
  $i = $j
  while ($i-- -ne 0) { if ($str[$i] -match "\s") { break; } }
  $str.Substring($i + 1, $j - $i)
}

$_bun_get_completes = {
  param([System.Management.Automation.Language.CommandAst]$commandAst, $param)

  if ($param -eq '--cwd') { return }

  $cwd = & $_bun_get_cwd $commandAst.CommandElements

  switch -regex ($commandAst.CommandElements[1].Value) {
    "^run$" {
      if ($param -eq '--jsx-runtime') { return @('classic', 'automatic') }
      if ($param -eq '--target') { return @('browser', 'bun', 'node') }
      if ($param -eq '--install') { return @('auto', 'force', 'fallback') }

      if ($commandAst.CommandElements.Count -gt 2) { return $_bun_subcommands_run }

      return ((& $_bun_get_scripts $cwd) + $(& $_bun_get_bins $cwd))
    }
    "^test$" {
      return $_bun_subcommands_test
    }
    "^x$" {
      return ''
    }
    "^repl$" {
      return ''
    }
    "^init$" {
      return $_bun_subcommands_init
    }
    "^create$" {
      return $_bun_subcommands_create
    }
    "^(install | i)$" {
      return $_bun_subcommands_install
    }
    "^(add | a)$" {
      return $_bun_subcommands_add
    }
    "^(remove | Remove-Item)$" {
      return ((& $_bun_get_dependecies $cwd) + $_bun_subcommands_remove)
    }
    "^update$" {
      return $_bun_subcommands_update
    }
    "^bun$" {
      if ($commandAst.CommandElements.Count -lt 3) { return }
      return $_bun_subcommands_bun
    }
    "^link$" {
      return $_bun_subcommands_link
    }
    "^unlink$" {
      return $_bun_subcommands_unlink
    }
    "^pm$" {
      return $_bun_subcommands_pm
    }
    "^build$" {
      if ($param -eq '--target') { return @('browser', 'bun', 'node') }
      if ($param -eq '--sourcemap') { return @('none', 'external', 'inline') }
      if ($param -eq '--format') { return @('esm', 'cjs', 'iife') }

      return $_bun_subcommands_build
    }
    "^upgrade$" {
      return $_bun_subcommands_upgrade
    }
    "^completions$" {
      return ''
    }
    "^help$" {
      return ''
    }
    "^discord$" {
      return ''
    }
    default {
      if ($commandAst.CommandElements.Count -gt 1) { return $_bun_subcommands_run }

      return ((& $_bun_get_scripts $cwd) + (& $_bun_get_files $cwd) + $_bun_subcommands)
    }
  }
}

$_bun_register_completer = {
  param($wordToComplete, $commandAst, $cursorPosition)

  $param = & $_bun_current_param $commandAst $cursorPosition
  ((& $_bun_get_completes $commandAst $param) | Where-Object { $_.CompletionText -like "$wordToComplete*" })
}

Microsoft.PowerShell.Core\Register-ArgumentCompleter -CommandName bun -Native -ScriptBlock $_bun_register_completer
