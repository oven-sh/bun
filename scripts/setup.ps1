throw "This script is not yet complete";

New-Item -Type SymbolicLink -Path .\.vscode\clang++ -Value (Get-Command clang-cl).Source