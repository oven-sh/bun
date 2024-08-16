throw "This script is not yet complete";

npm i

.\scripts\update-submodules.ps1
.\scripts\all-dependencies.ps1
.\scripts\make-old-js.ps1

New-Item -Type SymbolicLink -Path .\.vscode\clang++ -Value (Get-Command clang-cl).Source
