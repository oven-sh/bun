<#
.SYNOPSIS
  This is a PowerShell script that provides tab completion for the Bun CLI.

.DESCRIPTION
  This script will be installed into a users ~/.bun directory as bun.completion.ps1 by `bun completions`.
  Users can source it in their PowerShell profile e.g. `. ~/.bun/bun.completion.ps1` to enable tab completion for the Bun CLI.

.NOTES
  Subcommands are defined in this script and where possible use `bun getcompletes` to provide dynamic auto-complete.
  Subcommand argument completion uses `--help` on subcommands as required, so it's not as full featured as the bash completion script but it will stay in sync with args as bun is updated.
  To provide more advanced auto-complete requires re-implementation of the bun arguments parsing in PowerShell, which is not feasible.
  Ideally the `bun getcompletes` command could be extended to provide more completions then the shell completers can rely on it.
#>

# Pattern used to extract flags from `bun --help` output
$script:BunHelpFlagPattern = "^\s+(?<Alias>-[\w]+)?,?\s+(?<LongName>--[-\w]+)?\s+(?<Description>.+?)$"
# Global arguments are cached in memory after the first load
$script:BunGlobalArguments = $null
# Subcommands are manually defined because `bun getcompletes` doesn't provide info on them
$script:BunSubCommands = @(
  @{
    Name        = "run"
    Description = "Execute a file with Bun or run a package.json script"
    Completers  = @(
      {
        # Get scripts runnable from package json via `bun getcompletes z`
        param (
          [string] $WordToComplete
        )
        $env:MAX_DESCRIPTION_LEN = 250
        return & bun getcompletes z | Where-Object { $_ -like "$WordToComplete*" } | Foreach-Object {
          $script = $_.Split("`t")
          [System.Management.Automation.CompletionResult]::new($script[0], $script[0], 'ParameterValue', $script[1])
        }
      },
      {
        # Get bins runnable via `bun getcompletes b`
        param (
          [string] $WordToComplete
        )
        return & bun getcompletes b | Where-Object { $_ -like "$WordToComplete*" } | Foreach-Object {
          [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
      },
      {
        # Get javascript files runnable via `bun getcompletes j`
        param (
          [string] $WordToComplete
        )
        return & bun getcompletes j | Where-Object { $_ -like "$WordToComplete*" } | ForEach-Object {
          [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
      }
    )
  },
  @{
    Name        = "test"
    Description = "Run unit tests with Bun"
  },
  @{
    Name        = "x"
    Description = "Execute a package binary (CLI), installing if needed (bunx)"
  },
  @{
    Name        = "repl"
    Description = "Start a REPL session with Bun"
  },
  @{
    Name        = "exec"
    Description = "Run a shell script directly with Bun"
  },
  @{
    Name        = "install"
    Alias       = "i"
    Description = "Install dependencies for a package.json (bun i)"
  },
  @{
    Name        = "add"
    Alias       = "a"
    Description = "Add a dependency to package.json (bun a)"
    Completers  = @(
      {
        # Get frequently installed packages via `bun getcompletes a`
        param (
          [string] $WordToComplete
        )
        Write-Debug "Completing package names for $WordToComplete"
        return & bun getcompletes a "$WordToComplete" | Foreach-Object {
          Write-Debug "Completing package $_"
          [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
      }
    )
  },
  @{
    Name        = "remove"
    Alias       = "rm"
    Description = "Remove a dependency from package.json (bun rm)"
    Completers  = @(
      {
        # Remove dependencies from package.json, this is not available in getcompletes
        param (
          [string] $WordToComplete
        )
        if (Test-Path "package.json") {
          $packageJson = Get-Content "package.json" -Raw | ConvertFrom-Json
          $packageJson.dependencies.PSObject.Properties.Name | Where-Object { $_ -like "$WordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
          }
        }
      }
    )
  },
  @{
    Name        = "update"
    Description = "Update outdated dependencies"
  },
  @{
    Name        = "link"
    Description = "Register or link a local npm package"
  },
  @{
    Name        = "unlink"
    Description = "Unregister a local npm package"
  },
  @{
    Name        = "pm"
    Description = "Additional package management utilities"
  },
  @{
    Name        = "build"
    Description = "Bundle TypeScript & JavaScript into a single file"
  },
  @{
    Name        = "init"
    Description = "Start an empty Bun project from a blank template"
  },
  @{
    Name        = "create"
    Alias       = "c"
    Description = "Create a new project from a template (bun c)"
  },
  @{
    Name        = "upgrade"
    Description = "Upgrade to latest version of Bun."
  },
  @{
    Name        = "discord"
    Description = "Join the Bun Discord server"
  }
)

function Get-BunSubCommandCompletions {
  param (
    [string] $SubCommandName,
    [System.Management.Automation.Language.CommandAst] $CommandAst,
    [string] $WordToComplete
  )

  $subCommandCompletions = @()

  $subCommand = $script:BunSubCommands | Where-Object { $_.Name -eq $SubCommandName -or $_.Alias -eq $SubCommandName }

  if ($CommandAst.CommandElements.Count -eq 1) {
    # Get the subcommand name completions
    $script:BunSubCommands | ForEach-Object {
      $subCommandCompletions += [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ParameterValue', $_.Description)
    }
  } elseif ($CommandAst.CommandElements.Count -eq 2 -and -not [string]::IsNullOrWhiteSpace($WordToComplete)) {
    # Get the subcommand name completions with a partially complete subcommand name
    $script:BunSubCommands | Where-Object { $_.Name -like "$WordToComplete*" } | ForEach-Object {
      $subCommandCompletions += [System.Management.Automation.CompletionResult]::new($_.Name, $_.Name, 'ParameterValue', $_.Description)
    }
  } elseif ($subCommand -and ($CommandAst.CommandElements.Count -gt 2 -or [string]::IsNullOrWhiteSpace($WordToComplete))) {
    # Invoke all dynamic completers for the subcommand
    if ($subCommand.Completers) {
      $subCommandCompletions += $subCommand.Completers | ForEach-Object {
        $_.Invoke($WordToComplete)
      }
    }

    # Get all arguments exposed in help with regex capture https://regex101.com/r/lTzfLB/1
    & bun $SubCommandName --help *>&1 | Select-String $script:BunHelpFlagPattern | ForEach-Object {

      $alias = $_.Matches.Groups | Where-Object { $_.Name -eq 'Alias' } | Select-Object -ExpandProperty Value
      $name = $_.Matches.Groups | Where-Object { $_.Name -eq 'LongName' } | Select-Object -ExpandProperty Value
      $description = $_.Matches.Groups | Where-Object { $_.Name -eq 'Description' } | Select-Object -ExpandProperty Value

      if ($name -like "$WordToComplete*" -or $alias -like "$WordToComplete*") {
        $completionName = if (-not [string]::IsNullOrWhiteSpace($name)) { $name } else { $alias }
        $subCommandCompletions += [System.Management.Automation.CompletionResult]::new($completionName, $completionName, 'ParameterValue', $description)
      }
    }
  }

  return $subCommandCompletions
}

function Get-BunGlobalArgumentCompletions {
  param (
    [string] $WordToComplete
  )

  # These don't change often, keep them in memory after the first load
  if ($null -eq $script:BunGlobalArguments) {
    $script:BunGlobalArguments = @()
    & bun --help *>&1 | Select-String $script:BunHelpFlagPattern | ForEach-Object {

      $alias = $_.Matches.Groups | Where-Object { $_.Name -eq 'Alias' } | Select-Object -ExpandProperty Value
      $name = $_.Matches.Groups | Where-Object { $_.Name -eq 'LongName' } | Select-Object -ExpandProperty Value
      $description = $_.Matches.Groups | Where-Object { $_.Name -eq 'Description' } | Select-Object -ExpandProperty Value

      if (-not [string]::IsNullOrWhitespace($alias) -or -not [string]::IsNullOrWhiteSpace($name)) {
        $script:BunGlobalArguments += @{
          Name        = $name
          Alias       = $alias
          Description = $description
        }
      }
    }
  }

  return $script:BunGlobalArguments | Where-Object { $_.Name -like "$WordToComplete*" -or $_.Alias -like "$WordToComplete*" } | ForEach-Object {
    $completionName = if (-not [string]::IsNullOrWhiteSpace($_.Name)) { $_.Name } else { $_.Alias }
    [System.Management.Automation.CompletionResult]::new($completionName, $completionName, 'ParameterValue', $_.Description)
  }
}

Register-ArgumentCompleter -Native -CommandName "bun" -ScriptBlock {
  param(
    [string] $WordToComplete,
    [System.Management.Automation.Language.CommandAst] $CommandAst,
    [int] $CursorPosition
  )

  $subCommandName = if ($CommandAst.CommandElements.Count -ge 2) { $CommandAst.CommandElements[1].Extent.Text.Trim() } else { $null }

  $completions = @()
  $completions += Get-BunSubCommandCompletions -SubCommandName $subCommandName -CommandAst $CommandAst -WordToComplete $WordToComplete
  $completions += Get-BunGlobalArgumentCompletions -WordToComplete $WordToComplete
  return $completions | Select-Object * -Unique | Foreach-Object { [System.Management.Automation.CompletionResult]::new($_.CompletionText, $_.ListItemText, $_.ResultType, $_.ToolTip) }
}
