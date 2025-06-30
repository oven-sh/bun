$ScriptDirectory = Split-Path -parent $PSCommandPath
& "$ScriptDirectory/emsdk.ps1" construct_env
