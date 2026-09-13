# Static completer logic appended to the generated data tables by
# misctools/generate-powershell-completions.ts. Compatible with
# Windows PowerShell 5.1 and PowerShell 7+.

function script:__bunFlagTable([string]$cmd) {
    # The shared package-manager flag table only applies to the package-manager
    # commands; other commands get just their own flags plus the globals.
    $table = $script:BunFlags[$cmd]
    if (-not $table -and $script:BunSharedCommands -contains $cmd) { $table = $script:BunFlags['*'] }
    if (-not $table) { $table = @{} }
    foreach ($key in $script:BunGlobalFlags.Keys) { if (-not $table.ContainsKey($key)) { $table[$key] = $script:BunGlobalFlags[$key] } }
    return $table
}

function script:__bunWantsValue([string]$cmd, [string]$flag) {
    if ($flag -notmatch '^--[a-zA-Z0-9][a-zA-Z0-9-]*$' -and $flag -notmatch '^-[a-zA-Z0-9]$') { return $false }
    $table = $script:BunValueFlags[$cmd]
    if ($table -and $table.ContainsKey($flag)) { return $true }
    if ($script:BunGlobalValueFlags.ContainsKey($flag)) { return $true }
    if ($script:BunSharedCommands -notcontains $cmd) { return $false }
    $shared = $script:BunValueFlags['*']
    return $shared -and $shared.ContainsKey($flag)
}

function script:__bunCompleteFlags([string]$cmd, [string]$word) {
    $table = __bunFlagTable $cmd
    $results = @()
    foreach ($key in $table.Keys) {
        if ($word -ne "" -and -not $key.StartsWith($word)) { continue }
        $results += __bunResult $key $key $table[$key]
    }
    return $results
}

function script:__bunCompleteScriptResults([string]$word) {
    $results = @()
    foreach ($line in __bunCompleteScripts) {
        $parts = $line -split "`t", 2
        if ($parts[0] -and $parts[0].StartsWith($word)) {
            $tooltip = 'package.json script'
            if ($parts.Length -gt 1 -and $parts[1]) { $tooltip = $parts[1] }
            $results += __bunResult $parts[0] $parts[0] $tooltip
        }
    }
    return $results
}

Register-ArgumentCompleter -CommandName bun, bunx -Native -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)

    $commandName = $commandAst.CommandElements[0].Extent.Text
    $tokens = @($commandAst.CommandElements | Select-Object -Skip 1 | ForEach-Object { $_.Extent.Text })

    # 'bunx' is equivalent to 'bun x <package>'.
    $cmd = if ($commandName -eq 'bunx') { 'x' } else { '' }
    $pendingFlag = ''   # set while a flag that takes a value awaits it

    for ($i = 0; $i -lt $tokens.Count; $i++) {
        $token = $tokens[$i]
        $isCurrent = $i -eq $tokens.Count - 1 -and $token -eq $wordToComplete
        if ($pendingFlag) {
            if (-not $isCurrent) { $pendingFlag = '' }
            continue
        }
        if ($token.StartsWith('-')) {
            # '--flag=value' carries its own value.
            if (-not $isCurrent -and $token -notmatch '=' -and (__bunWantsValue $cmd ($token -replace '=.*$', ''))) { $pendingFlag = $token }
            continue
        }
        if (-not $isCurrent -and $cmd -eq '') { $cmd = $token }
    }

    # A flag is waiting for its value: return known choices; for everything else
    # return nothing so PowerShell's built-in completion applies.
    if ($pendingFlag) {
        $choices = $script:BunFlagChoices[$pendingFlag]
        if (-not $choices) { return @() }
        return @($choices -split ' ' | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object { __bunResult $_ $_ '' })
    }

    if ($wordToComplete.StartsWith('-')) {
        return __bunCompleteFlags $cmd $wordToComplete
    }

    if ($cmd -eq '') {
        # Completing the subcommand: commands plus package.json scripts.
        $results = @()
        foreach ($name in $script:BunCommands.Keys) {
            if ($name.StartsWith($wordToComplete)) { $results += __bunResult $name $name $script:BunCommands[$name] }
        }
        $results += __bunCompleteScriptResults $wordToComplete
        return $results
    }

    switch ($cmd) {
        'run' {
            $results = @(__bunCompleteScriptResults $wordToComplete)
            foreach ($bin in __bunCompleteBins) {
                if ($bin.StartsWith($wordToComplete)) { $results += __bunResult $bin $bin 'package bin' }
            }
            return $results
        }
        'pm' {
            $results = @()
            foreach ($name in $script:BunPmSubcommands.Keys) {
                if ($name.StartsWith($wordToComplete)) { $results += __bunResult $name $name $script:BunPmSubcommands[$name] }
            }
            return $results
        }
        'create' {
            $results = @()
            foreach ($template in $script:BunCreateTemplates) {
                if ($template.StartsWith($wordToComplete)) { $results += __bunResult $template $template 'template' }
            }
            return $results
        }
        default {
            # 'x' (and 'bunx') run an npm package executable; install/add take
            # package names. Both complete through 'bun getcompletes a'.
            if ($script:BunPackageCommands -contains $cmd -or $cmd -eq 'x') {
                return @(__bunCompletePackages $wordToComplete | ForEach-Object { __bunResult $_ $_ 'package' })
            }
            # Files, paths, and everything else: no results lets PowerShell's
            # built-in native completion take over.
            return @()
        }
    }
}
