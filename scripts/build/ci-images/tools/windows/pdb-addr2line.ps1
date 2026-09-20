# Symbolicates the stack traces of a crashed bun.exe from its .pdb.
Run cargo install --locked --examples "pdb-addr2line@$PDB_ADDR2LINE_VERSION"
Copy-Item "$env:CARGO_HOME\bin\pdb-addr2line.exe" "C:\Windows\System32\pdb-addr2line.exe" -Force
