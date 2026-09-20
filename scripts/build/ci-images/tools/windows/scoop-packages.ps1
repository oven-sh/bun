# 7zip comes first: scoop unpacks git's self-extracting archive with it.
foreach ($package in $SCOOP_PACKAGES.Split(" ")) {
  Install-Scoop-Package $package
}
# Git's own Unix tools (sh, tar, …) and Cygwin's, for the scripts tests run.
Add-To-Path "$SCOOP\apps\git\current\usr\bin"
Add-To-Path "$SCOOP\apps\cygwin\current\root\bin"

Run git config --system --add safe.directory "*"
Run git config --system core.autocrlf false
Run git config --system core.eol lf
Run git config --system core.longpaths true
