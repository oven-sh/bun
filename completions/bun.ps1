# PowerShell completion for bun
# Generated from completions/bun-cli.json
# To install: Add `. path/to/bun.ps1` to your $PROFILE

using namespace System.Management.Automation

# Helper: get package.json scripts
function _bun_get_scripts {
    $packageJson = Join-Path $PWD 'package.json'
    if (Test-Path $packageJson) {
        try {
            $pkg = Get-Content $packageJson -Raw | ConvertFrom-Json
            if ($pkg.scripts) {
                $pkg.scripts.PSObject.Properties | ForEach-Object {
                    [CompletionResult]::new($_.Name, $_.Name, 'ParameterValue', $_.Value)
                }
            }
        } catch {}
    }
}

# Helper: get installed binaries from node_modules/.bin
function _bun_get_bins {
    $binDir = Join-Path $PWD 'node_modules' '.bin'
    if (Test-Path $binDir) {
        Get-ChildItem $binDir -File | ForEach-Object {
            $name = $_.BaseName
            [CompletionResult]::new($name, $name, 'ParameterValue', "Binary: $name")
        }
    }
}

# Helper: complete JavaScript/TypeScript files (supports subdirectory paths)
function _bun_get_js_files {
    param([string]$wordToComplete)
    # Split into directory and filename parts to handle paths like src/index
    $dirPart = Split-Path $wordToComplete -ErrorAction SilentlyContinue
    $namePart = Split-Path $wordToComplete -Leaf -ErrorAction SilentlyContinue
    if (-not $namePart) { $namePart = $wordToComplete }
    $searchDir = if ($dirPart) { Join-Path $PWD $dirPart } else { $PWD }
    if (-not (Test-Path $searchDir -PathType Container)) { return }
    Get-ChildItem -Path $searchDir -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "$namePart*" -and $_.Extension -match '\.(js|jsx|ts|tsx|mjs|mts|cjs|cts)$' } |
        ForEach-Object {
            $rel = $_.FullName.Substring($PWD.Path.Length + 1).Replace('\', '/')
            [CompletionResult]::new($rel, $rel, 'ParameterValue', $_.Name)
        }
}

# Helper: get installed dependencies from package.json
function _bun_get_dependencies {
    param([string]$wordToComplete)
    $packageJson = Join-Path $PWD 'package.json'
    if (Test-Path $packageJson) {
        try {
            $pkg = Get-Content $packageJson -Raw | ConvertFrom-Json
            @('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies') | ForEach-Object {
                if ($pkg.$_) {
                    $pkg.$_.PSObject.Properties | Where-Object { $_.Name -like "$wordToComplete*" } | ForEach-Object {
                        [CompletionResult]::new($_.Name, $_.Name, 'ParameterValue', $_.Value)
                    }
                }
            }
        } catch {}
    }
}

Register-ArgumentCompleter -Native -CommandName bun, bunx -ScriptBlock {
    param(
        [string]$wordToComplete,
        [string]$commandAst,
        [int]$cursorPosition
    )

    # Parse the command line into tokens
    $tokens = $commandAst.Substring(0, $cursorPosition) -split '\s+' | Where-Object { $_ }
    $tokenCount = $tokens.Count
    $currentToken = if ($wordToComplete) { $wordToComplete } else { '' }

    # Find the subcommand (first non-flag token after 'bun')
    $subcommand = $null
    for ($i = 1; $i -lt $tokenCount; $i++) {
        if (-not $tokens[$i].StartsWith('-')) {
            $subcommand = $tokens[$i]
            break
        }
    }

    # If we're still completing the subcommand or there's no subcommand yet
    if (-not $subcommand -or ($subcommand -eq $currentToken -and $tokenCount -le 2)) {
        # Suggest subcommands
        $subcommands = @(
            @{ Name = 'run';       Desc = 'Run a file or script' }
            @{ Name = 'test';      Desc = 'Run tests' }
            @{ Name = 'x';         Desc = 'Execute a package binary (bunx)' }
            @{ Name = 'repl';      Desc = 'Start a REPL session' }
            @{ Name = 'exec';      Desc = 'Run an executable' }
            @{ Name = 'install';   Desc = 'Install dependencies' }
            @{ Name = 'add';       Desc = 'Add a dependency' }
            @{ Name = 'remove';    Desc = 'Remove a dependency' }
            @{ Name = 'update';    Desc = 'Update dependencies' }
            @{ Name = 'audit';     Desc = 'Audit dependencies for vulnerabilities' }
            @{ Name = 'outdated';  Desc = 'Show outdated dependencies' }
            @{ Name = 'link';      Desc = 'Link an npm package globally' }
            @{ Name = 'unlink';    Desc = 'Unlink a globally linked package' }
            @{ Name = 'publish';   Desc = 'Publish a package to the registry' }
            @{ Name = 'patch';     Desc = 'Patch a dependency' }
            @{ Name = 'pm';        Desc = 'Package manager utilities' }
            @{ Name = 'info';      Desc = 'Show package info' }
            @{ Name = 'build';     Desc = 'Bundle TypeScript & JavaScript' }
            @{ Name = 'init';      Desc = 'Initialize a new project' }
            @{ Name = 'create';    Desc = 'Create a new project from a template' }
            @{ Name = 'upgrade';   Desc = 'Upgrade bun' }
        )
        $subcommands | Where-Object { $_.Name -like "$currentToken*" } | ForEach-Object {
            [CompletionResult]::new($_.Name, $_.Name, 'ParameterValue', $_.Desc)
        }

        # Also suggest scripts and binaries for implicit `bun run`
        if (-not $currentToken.StartsWith('-')) {
            _bun_get_scripts
            _bun_get_bins
        }

        # Global flags
        if ($currentToken.StartsWith('-')) {
            _bun_complete_global_flags $currentToken
        }

        return
    }

    # Complete flags and args for known subcommands
    if ($currentToken.StartsWith('-')) {
        switch ($subcommand) {
            'test'     { _bun_complete_test_flags $currentToken }
            'install'  { _bun_complete_install_flags $currentToken }
            'add'      { _bun_complete_install_flags $currentToken }
            'remove'   { _bun_complete_install_flags $currentToken }
            'update'   { _bun_complete_install_flags $currentToken }
            'build'    { _bun_complete_build_flags $currentToken }
            'init'     { _bun_complete_init_flags $currentToken }
            'publish'  { _bun_complete_publish_flags $currentToken; _bun_complete_install_flags $currentToken }
            'outdated' { _bun_complete_install_flags $currentToken }
            'link'     { _bun_complete_install_flags $currentToken }
            'unlink'   { _bun_complete_install_flags $currentToken }
            'patch'    { _bun_complete_patch_flags $currentToken }
            'info'     { _bun_complete_install_flags $currentToken }
            'audit'    { _bun_complete_audit_flags $currentToken }
            default    { _bun_complete_global_flags $currentToken }
        }
        return
    }

    # Non-flag completions for subcommands
    switch ($subcommand) {
        'run' {
            _bun_get_scripts
            _bun_get_bins
            _bun_get_js_files $currentToken
        }
        'test' {
            _bun_get_js_files $currentToken
        }
        'remove' {
            _bun_get_dependencies $currentToken
        }
        'pm' {
            @('bin', 'cache', 'default-trusted', 'hash', 'hash-print', 'hash-string',
              'ls', 'migrate', 'pack', 'pkg', 'scan', 'trust', 'untrusted',
              'version', 'view', 'whoami', 'why') |
                Where-Object { $_ -like "$currentToken*" } |
                ForEach-Object {
                    [CompletionResult]::new($_, $_, 'ParameterValue', "pm $_")
                }
        }
    }
}

function _bun_complete_global_flags {
    param([string]$word)
    $flags = @(
        @{ Name = '--watch';             Desc = 'Automatically restart the process on file change' }
        @{ Name = '--hot';               Desc = 'Enable hot reloading' }
        @{ Name = '--no-clear-screen';   Desc = "Don't clear the terminal screen on reload" }
        @{ Name = '--smol';              Desc = 'Use less memory but run garbage collection more often' }
        @{ Name = '--preload';           Desc = 'Import a module before other modules are loaded' }
        @{ Name = '--inspect';           Desc = 'Activate the inspector' }
        @{ Name = '--inspect-wait';      Desc = 'Activate the inspector and wait for a debugger to attach' }
        @{ Name = '--inspect-brk';       Desc = 'Activate the inspector, wait, and break on the first statement' }
        @{ Name = '--if-present';        Desc = "Don't error if the entrypoint does not exist" }
        @{ Name = '--no-install';        Desc = 'Disable auto install in bun run' }
        @{ Name = '--install';           Desc = 'Configure auto install behavior (auto|fallback|force)' }
        @{ Name = '--eval';              Desc = 'Evaluate argument as a script' }
        @{ Name = '--print';             Desc = 'Evaluate argument as a script and print the result' }
        @{ Name = '--prefer-offline';    Desc = 'Skip staleness checks for packages and use the cached version' }
        @{ Name = '--prefer-latest';     Desc = 'Use the latest matching versions of packages' }
        @{ Name = '--port';              Desc = 'Set the default port for Bun.serve' }
        @{ Name = '--conditions';        Desc = 'Resolve package.json exports conditions' }
        @{ Name = '--silent';            Desc = "Don't print the script command" }
        @{ Name = '--version';           Desc = 'Print version and exit' }
        @{ Name = '--revision';          Desc = 'Print version with revision and exit' }
        @{ Name = '--filter';            Desc = 'Run command in all workspace packages matching the pattern' }
        @{ Name = '--bun';               Desc = 'Force a script or package to use bun runtime' }
        @{ Name = '--shell';             Desc = 'Control which shell to use for package.json scripts' }
        @{ Name = '--env-file';          Desc = 'Load environment variables from the specified file(s)' }
        @{ Name = '--cwd';               Desc = 'Set a specific working directory' }
        @{ Name = '--config';            Desc = 'Specify path to config file (bunfig.toml)' }
        @{ Name = '--help';              Desc = 'Print help menu' }
        @{ Name = '-e';                  Desc = 'Evaluate argument as a script' }
        @{ Name = '-p';                  Desc = 'Evaluate and print result' }
        @{ Name = '-b';                  Desc = 'Force bun runtime' }
        @{ Name = '-r';                  Desc = 'Preload a module' }
        @{ Name = '-v';                  Desc = 'Print version' }
        @{ Name = '-h';                  Desc = 'Print help' }
        @{ Name = '-c';                  Desc = 'Specify config file' }
        @{ Name = '-i';                  Desc = 'Auto-install dependencies' }
        @{ Name = '-F';                  Desc = 'Filter workspaces' }
    )
    $flags | Where-Object { $_.Name -like "$word*" } | ForEach-Object {
        [CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Desc)
    }
}

function _bun_complete_test_flags {
    param([string]$word)
    $flags = @(
        @{ Name = '--timeout';           Desc = 'Set the per-test timeout in milliseconds (default 5000)' }
        @{ Name = '--update-snapshots';  Desc = 'Update snapshot files' }
        @{ Name = '--rerun-each';        Desc = 'Re-run each test file N times' }
        @{ Name = '--retry';             Desc = 'Default retry count for all tests' }
        @{ Name = '--only';              Desc = 'Only run tests marked with test.only()' }
        @{ Name = '--todo';              Desc = 'Include tests marked with test.todo()' }
        @{ Name = '--coverage';          Desc = 'Generate a coverage profile' }
        @{ Name = '--coverage-reporter'; Desc = "Report coverage in 'text' and/or 'lcov'" }
        @{ Name = '--coverage-dir';      Desc = 'Directory for coverage files' }
        @{ Name = '--bail';              Desc = 'Exit the test suite after N failures' }
        @{ Name = '--test-name-pattern'; Desc = 'Run only tests matching the given regex' }
        @{ Name = '--reporter';          Desc = 'Test output reporter format' }
        @{ Name = '--reporter-outfile';  Desc = 'Output file path for the reporter format' }
        @{ Name = '-u';                  Desc = 'Update snapshots' }
        @{ Name = '-t';                  Desc = 'Filter tests by name pattern' }
    )
    $flags | Where-Object { $_.Name -like "$word*" } | ForEach-Object {
        [CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Desc)
    }
    _bun_complete_global_flags $word
}

function _bun_complete_install_flags {
    param([string]$word)
    $flags = @(
        @{ Name = '--config';            Desc = 'Specify path to config file (bunfig.toml)' }
        @{ Name = '--yarn';              Desc = 'Write a yarn.lock file (yarn v1)' }
        @{ Name = '--production';        Desc = "Don't install devDependencies" }
        @{ Name = '--no-save';           Desc = "Don't update package.json or save a lockfile" }
        @{ Name = '--save';              Desc = 'Save to package.json (true by default)' }
        @{ Name = '--dry-run';           Desc = "Don't install anything" }
        @{ Name = '--frozen-lockfile';   Desc = 'Disallow changes to lockfile' }
        @{ Name = '--force';             Desc = 'Always request latest versions from registry' }
        @{ Name = '--cache-dir';         Desc = 'Store & load cached data from a specific directory' }
        @{ Name = '--no-cache';          Desc = 'Ignore manifest cache entirely' }
        @{ Name = '--silent';            Desc = "Don't log anything" }
        @{ Name = '--verbose';           Desc = 'Excessively verbose logging' }
        @{ Name = '--no-progress';       Desc = 'Disable the progress bar' }
        @{ Name = '--no-summary';        Desc = "Don't print a summary" }
        @{ Name = '--no-verify';         Desc = 'Skip verifying integrity of newly downloaded packages' }
        @{ Name = '--ignore-scripts';    Desc = 'Skip lifecycle scripts in the project package.json' }
        @{ Name = '--trust';             Desc = "Add to trustedDependencies in the project's package.json" }
        @{ Name = '--global';            Desc = 'Install globally' }
        @{ Name = '--cwd';               Desc = 'Set a specific working directory' }
        @{ Name = '--backend';           Desc = 'Platform-specific optimizations (copyfile|hardlink|symlink)' }
        @{ Name = '--registry';          Desc = 'Use a specific registry' }
        @{ Name = '--concurrent-scripts'; Desc = 'Maximum number of concurrent jobs for lifecycle scripts' }
        @{ Name = '--save-text-lockfile'; Desc = 'Save a text-based lockfile' }
        @{ Name = '--lockfile-only';     Desc = 'Generate a lockfile without installing dependencies' }
        @{ Name = '--help';              Desc = 'Print help menu' }
        @{ Name = '--dev';               Desc = 'Add dependency to devDependencies' }
        @{ Name = '--optional';          Desc = 'Add dependency to optionalDependencies' }
        @{ Name = '--peer';              Desc = 'Add dependency to peerDependencies' }
        @{ Name = '--exact';             Desc = 'Add the exact version instead of the ^range' }
        @{ Name = '--filter';            Desc = 'Install packages for matching workspaces' }
        @{ Name = '-c';                  Desc = 'Specify config file' }
        @{ Name = '-y';                  Desc = 'Write yarn.lock' }
        @{ Name = '-p';                  Desc = 'Production mode' }
        @{ Name = '-f';                  Desc = 'Force reinstall' }
        @{ Name = '-g';                  Desc = 'Install globally' }
        @{ Name = '-d';                  Desc = 'Add to devDependencies' }
        @{ Name = '-D';                  Desc = 'Add to devDependencies' }
        @{ Name = '-E';                  Desc = 'Add exact version' }
        @{ Name = '-h';                  Desc = 'Print help' }
    )
    $flags | Where-Object { $_.Name -like "$word*" } | ForEach-Object {
        [CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Desc)
    }
}

function _bun_complete_build_flags {
    param([string]$word)
    $flags = @(
        @{ Name = '--compile';           Desc = 'Generate a standalone executable' }
        @{ Name = '--outdir';            Desc = 'Directory for output files (default: ".")' }
        @{ Name = '--outfile';           Desc = 'Write all output files to this path' }
        @{ Name = '--target';            Desc = 'The intended execution environment (browser|bun|node)' }
        @{ Name = '--format';            Desc = 'Specifies the module format (esm|cjs|iife)' }
        @{ Name = '--minify';            Desc = 'Enable all minification' }
        @{ Name = '--minify-syntax';     Desc = 'Minify syntax without changing variable names' }
        @{ Name = '--minify-whitespace'; Desc = 'Minify whitespace' }
        @{ Name = '--minify-identifiers'; Desc = 'Minify identifiers' }
        @{ Name = '--splitting';         Desc = 'Enable code splitting' }
        @{ Name = '--sourcemap';         Desc = 'Generate source maps (none|inline|linked|external)' }
        @{ Name = '--entry-naming';      Desc = 'Customize entry point filenames' }
        @{ Name = '--chunk-naming';      Desc = 'Customize chunk filenames' }
        @{ Name = '--asset-naming';      Desc = 'Customize asset filenames' }
        @{ Name = '--external';          Desc = 'Exclude a module from the bundle' }
        @{ Name = '--packages';          Desc = 'How to handle packages (bundle|external)' }
        @{ Name = '--define';            Desc = 'Substitute K:V expression while parsing' }
        @{ Name = '--loader';            Desc = 'Parse files with a given loader' }
        @{ Name = '--root';              Desc = 'Root directory used for path resolution' }
        @{ Name = '--public-path';       Desc = 'A prefix to be appended to any import paths in bundled code' }
        @{ Name = '--drop';              Desc = 'Remove calls to specified functions' }
        @{ Name = '--banner';            Desc = 'Text prepended to each output file' }
        @{ Name = '--footer';            Desc = 'Text appended to each output file' }
        @{ Name = '--env';               Desc = 'How to handle environment variables (inline|disable)' }
        @{ Name = '--emit-dce-annotations'; Desc = 'Emit dead-code elimination annotations' }
        @{ Name = '--ignore-dce-annotations'; Desc = 'Ignore dead-code elimination annotations' }
        @{ Name = '--conditions';        Desc = 'Resolve package.json exports conditions' }
        @{ Name = '--help';              Desc = 'Print help menu' }
        @{ Name = '-h';                  Desc = 'Print help' }
    )
    $flags | Where-Object { $_.Name -like "$word*" } | ForEach-Object {
        [CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Desc)
    }
}

function _bun_complete_init_flags {
    param([string]$word)
    $flags = @(
        @{ Name = '--yes';  Desc = 'Accept all defaults' }
        @{ Name = '--open'; Desc = 'Open in browser after creation' }
        @{ Name = '-y';     Desc = 'Accept all defaults' }
        @{ Name = '--help'; Desc = 'Print help menu' }
    )
    $flags | Where-Object { $_.Name -like "$word*" } | ForEach-Object {
        [CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Desc)
    }
}

function _bun_complete_audit_flags {
    param([string]$word)
    $flags = @(
        @{ Name = '--level'; Desc = 'Minimum severity level (info|low|moderate|high|critical)' }
        @{ Name = '--help';  Desc = 'Print help menu' }
    )
    $flags | Where-Object { $_.Name -like "$word*" } | ForEach-Object {
        [CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Desc)
    }
}

function _bun_complete_publish_flags {
    param([string]$word)
    # Publish-specific flags (in addition to shared install flags)
    $flags = @(
        @{ Name = '--access';       Desc = 'Set package access level (public|restricted)' }
        @{ Name = '--tag';          Desc = 'Publish with a specific dist-tag' }
        @{ Name = '--otp';          Desc = 'One-time password for 2FA' }
        @{ Name = '--dry-run';      Desc = "Don't actually publish" }
        @{ Name = '--auth-type';    Desc = 'Authentication type (legacy|web)' }
    )
    $flags | Where-Object { $_.Name -like "$word*" } | ForEach-Object {
        [CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Desc)
    }
}

function _bun_complete_patch_flags {
    param([string]$word)
    $flags = @(
        @{ Name = '--commit';       Desc = 'Apply the patch and commit changes' }
        @{ Name = '--patches-dir';  Desc = 'Directory to store patch files' }
        @{ Name = '--help';         Desc = 'Print help menu' }
        @{ Name = '-h';             Desc = 'Print help' }
    )
    $flags | Where-Object { $_.Name -like "$word*" } | ForEach-Object {
        [CompletionResult]::new($_.Name, $_.Name, 'ParameterName', $_.Desc)
    }
    _bun_complete_install_flags $word
}
